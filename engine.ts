export {};
import { createClient, SupabaseClient } from '@supabase/supabase-js';
declare var require: any;
const crypto = require('crypto');

// Interfaces for Type Safety
interface CrashResult {
    serverSeed: string;
    clientSeed: string;
    hash: string;
    point: number;
}

interface GameRound {
    id: number;
    status: string;
    hash: string;
}

// Configuration
const supabase: SupabaseClient = createClient(
    'https://ymmixcalloktrohxkswk.supabase.co', 
    'sb_publishable_TkYwktWZWyRe-V5JHYXXgw_SoYtHBUy'
);

const HOUSE_EDGE: number = 0.03; 
const PROMO_MODE: boolean = false;

let currentRoundId: number | null = null;
let currentMultiplier: number = 1.0;
let gameStatus: 'waiting' | 'playing' | 'crashed' = 'waiting';
let crashPoint: number = 0;

/**
 * Generates a provably fair crash point using HMAC-SHA256
 */
function generateProvablyFairCrash(promoOverride: number | null): CrashResult {
    if (PROMO_MODE && promoOverride) {
        return { serverSeed: '', clientSeed: '', hash: '', point: promoOverride };
    }

    const serverSeed: string = crypto.randomBytes(32).toString('hex');
    const clientSeed: string = crypto.randomBytes(16).toString('hex');
    const hash: string = crypto.createHmac('sha256', serverSeed).update(clientSeed).digest('hex');
    
    const n: number = parseInt(hash.substring(0, 8), 16);
    const float: number = n / 4294967296; 

    const point: number = Math.max(1.00, Math.floor((100 / (1 - float)) * (1 - HOUSE_EDGE)) / 100);
    return { serverSeed, clientSeed, hash, point };
}

async function broadcastGameEvent(event: string, payload: any): Promise<any> {
    return supabase.channel('game_state').send({
        type: 'broadcast',
        event,
        payload
    });
}

async function broadcastCountdown(seconds: number): Promise<void> {
    await broadcastGameEvent('countdown', {
        status: 'waiting',
        seconds,
        message: `Next round in ${seconds}...`
    });
}

async function processAutoCashouts(roundId: number, multiplier: number): Promise<number> {
    try {
        const { data, error } = await supabase.from('bets')
            .select('id, amount, auto_cashout, player_id')
            .eq('round_id', roundId)
            .eq('status', 'pending')
            .lte('auto_cashout', multiplier);

        if (error) {
            console.warn('Auto cashout query failed:', error);
            return 0;
        }

        const autoBets = Array.isArray(data) ? data : [];
        if (autoBets.length === 0) return 0;

        const ids = autoBets.map((bet: any) => bet.id);
        await supabase.from('bets')
            .update({ status: 'cashed_out', cashed_out_at: new Date().toISOString() })
            .in('id', ids)
            .eq('status', 'pending');

        await broadcastGameEvent('autoCashout', {
            roundId,
            multiplier: multiplier.toFixed(2),
            count: ids.length
        });

        return ids.length;
    } catch (err) {
        console.error('Auto cashout processing failed:', err);
        return 0;
    }
}

async function startGameLoop(): Promise<void> {
    while (true) {
        // 1. Setup Round
        gameStatus = 'waiting';
        const { serverSeed, clientSeed, hash, point } = generateProvablyFairCrash(null);
        crashPoint = point;

        const { data, error } = await supabase.from('game_rounds')
            .insert({ server_seed: serverSeed, client_seed: clientSeed, hash, status: 'pending' })
            .select()
            .single();
        
        const round = data as GameRound;
        currentRoundId = round ? round.id : null;

        await broadcastGameEvent('tick', { status: gameStatus, hash, crashPoint: crashPoint.toFixed(2) });

        for (let seconds = 3; seconds > 0; seconds--) {
            await broadcastCountdown(seconds);
            await new Promise(res => setTimeout(res, 1000));
        }

        await broadcastGameEvent('tick', { status: 'starting', multiplier: '1.00', message: 'Aviator takeoff' });

        // 2. Start Flight
        if (currentRoundId) {
            gameStatus = 'playing';
            await supabase.from('game_rounds')
                .update({ status: 'active', started_at: new Date().toISOString() })
                .eq('id', currentRoundId);
            
            let startTime: number = Date.now();
            currentMultiplier = 1.0;

            while (currentMultiplier < crashPoint) {
                const elapsedTime: number = Date.now() - startTime;
                currentMultiplier = Math.max(1.00, Math.exp(elapsedTime * 0.00006)); 

                if (currentMultiplier >= crashPoint) {
                    currentMultiplier = crashPoint;
                    break;
                }

                await processAutoCashouts(currentRoundId, currentMultiplier);
                await broadcastGameEvent('tick', {
                    status: gameStatus,
                    multiplier: currentMultiplier.toFixed(2)
                });
                await new Promise(res => setTimeout(res, 100));
            }

            // 3. Crash
            gameStatus = 'crashed';
            await supabase.from('game_rounds').update({ 
                status: 'crashed', 
                crash_point: crashPoint 
            }).eq('id', currentRoundId);

            await resolveBets(currentRoundId, crashPoint);
        }

        await broadcastGameEvent('tick', {
            status: gameStatus,
            multiplier: crashPoint.toFixed(2),
            finalSeed: serverSeed,
            message: 'Flew Away'
        });

        await new Promise(res => setTimeout(res, 4000)); 
    }
}

async function resolveBets(roundId: number, finalCrash: number): Promise<void> {
    await supabase.from('bets')
        .update({ status: 'lost' })
        .eq('round_id', roundId)
        .eq('status', 'pending');
}

startGameLoop();