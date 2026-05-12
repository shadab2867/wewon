export {};
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

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

        // Broadcast waiting
        supabase.channel('game_state').send({
            type: 'broadcast',
            event: 'tick',
            payload: { status: gameStatus, timeToStart: 5000, hash }
        });
        await new Promise(res => setTimeout(res, 5000));

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

                supabase.channel('game_state').send({
                    type: 'broadcast',
                    event: 'tick',
                    payload: { status: gameStatus, multiplier: currentMultiplier.toFixed(2) }
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

        supabase.channel('game_state').send({
            type: 'broadcast',
            event: 'tick',
            payload: { status: gameStatus, multiplier: crashPoint.toFixed(2), finalSeed: serverSeed }
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