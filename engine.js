import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// FIX 1: URL aur Key ko Inverted Commas (' ') ke andar daal diya hai.
const supabase = createClient('https://ymmixcalloktrohxkswk.supabase.co', 'sb_publishable_TkYwktWZWyRe-V5JHYXXgw_SoYtHBUy');
const HOUSE_EDGE = 0.03; // 3%
const PROMO_MODE = false; // Abhi ke liye ise false rakha hai taaki fair game chale

let currentRoundId = null;
let currentMultiplier = 1.0;
let gameStatus = 'waiting'; // waiting, playing, crashed
let crashPoint = 0;

// FIX 2: TypeScript ke types hata diye
function generateProvablyFairCrash(promoOverride) {
    if (PROMO_MODE && promoOverride) return promoOverride;

    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = crypto.randomBytes(16).toString('hex'); // In reality, drawn from last block/players
    const hash = crypto.createHmac('sha256', serverSeed).update(clientSeed).digest('hex');
    
    // Hash to float (0 to 1)
    const n = parseInt(hash.substring(0, 8), 16);
    const float = n / 4294967296; 

    // Calculate crash with 3% house edge
    const point = Math.max(1.00, Math.floor((100 / (1 - float)) * (1 - HOUSE_EDGE)) / 100);
    return { serverSeed, clientSeed, hash, point };
}

async function startGameLoop() {
    while (true) {
        // 1. Setup Round
        gameStatus = 'waiting';
        const { serverSeed, clientSeed, hash, point } = generateProvablyFairCrash(null);
        crashPoint = point;

        const { data: round } = await supabase.from('game_rounds')
            .insert({ server_seed: serverSeed, client_seed: clientSeed, hash, status: 'pending' })
            .select().single();
        
        currentRoundId = round ? round.id : null;

        // Broadcast waiting (5 seconds betting window)
        supabase.channel('game_state').send({
            type: 'broadcast',
            event: 'tick',
            payload: { status: gameStatus, timeToStart: 5000, hash }
        });
        await new Promise(res => setTimeout(res, 5000));

        // 2. Start Flight
        if (currentRoundId) {
            gameStatus = 'playing';
            await supabase.from('game_rounds').update({ status: 'active', started_at: new Date() }).eq('id', currentRoundId);
            
            let startTime = Date.now();
            currentMultiplier = 1.0;

            while (currentMultiplier < crashPoint) {
                const elapsedTime = Date.now() - startTime;
                // Exponential curve: e^(time * rate)
                currentMultiplier = Math.max(1.00, Math.exp(elapsedTime * 0.00006)); 

                if (currentMultiplier >= crashPoint) {
                    currentMultiplier = crashPoint;
                    break;
                }

                // Broadcast multiplier every 100ms
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

            // Resolve bets server-side
            await resolveBets(currentRoundId, crashPoint);
        }

        supabase.channel('game_state').send({
            type: 'broadcast',
            event: 'tick',
            payload: { status: gameStatus, multiplier: crashPoint.toFixed(2), finalSeed: serverSeed }
        });

        // Wait before next round
        await new Promise(res => setTimeout(res, 4000)); 
    }
}

// FIX 3: TypeScript ke types hata diye
async function resolveBets(roundId, finalCrash) {
    // Mark pending bets as lost
    await supabase.from('bets')
        .update({ status: 'lost' })
        .eq('round_id', roundId)
        .eq('status', 'pending');
}

startGameLoop();import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// FIX 1: URL aur Key ko Inverted Commas (' ') ke andar daal diya hai.
const supabase = createClient('https://ymmixcalloktrohxkswk.supabase.co', 'sb_publishable_TkYwktWZWyRe-V5JHYXXgw_SoYtHBUy');
const HOUSE_EDGE = 0.03; // 3%
const PROMO_MODE = false; // Abhi ke liye ise false rakha hai taaki fair game chale

let currentRoundId = null;
let currentMultiplier = 1.0;
let gameStatus = 'waiting'; // waiting, playing, crashed
let crashPoint = 0;

// FIX 2: TypeScript ke types hata diye
function generateProvablyFairCrash(promoOverride) {
    if (PROMO_MODE && promoOverride) return promoOverride;

    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = crypto.randomBytes(16).toString('hex'); // In reality, drawn from last block/players
    const hash = crypto.createHmac('sha256', serverSeed).update(clientSeed).digest('hex');
    
    // Hash to float (0 to 1)
    const n = parseInt(hash.substring(0, 8), 16);
    const float = n / 4294967296; 

    // Calculate crash with 3% house edge
    const point = Math.max(1.00, Math.floor((100 / (1 - float)) * (1 - HOUSE_EDGE)) / 100);
    return { serverSeed, clientSeed, hash, point };
}

async function startGameLoop() {
    while (true) {
        // 1. Setup Round
        gameStatus = 'waiting';
        const { serverSeed, clientSeed, hash, point } = generateProvablyFairCrash(null);
        crashPoint = point;

        const { data: round } = await supabase.from('game_rounds')
            .insert({ server_seed: serverSeed, client_seed: clientSeed, hash, status: 'pending' })
            .select().single();
        
        currentRoundId = round ? round.id : null;

        // Broadcast waiting (5 seconds betting window)
        supabase.channel('game_state').send({
            type: 'broadcast',
            event: 'tick',
            payload: { status: gameStatus, timeToStart: 5000, hash }
        });
        await new Promise(res => setTimeout(res, 5000));

        // 2. Start Flight
        if (currentRoundId) {
            gameStatus = 'playing';
            await supabase.from('game_rounds').update({ status: 'active', started_at: new Date() }).eq('id', currentRoundId);
            
            let startTime = Date.now();
            currentMultiplier = 1.0;

            while (currentMultiplier < crashPoint) {
                const elapsedTime = Date.now() - startTime;
                // Exponential curve: e^(time * rate)
                currentMultiplier = Math.max(1.00, Math.exp(elapsedTime * 0.00006)); 

                if (currentMultiplier >= crashPoint) {
                    currentMultiplier = crashPoint;
                    break;
                }

                // Broadcast multiplier every 100ms
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

            // Resolve bets server-side
            await resolveBets(currentRoundId, crashPoint);
        }

        supabase.channel('game_state').send({
            type: 'broadcast',
            event: 'tick',
            payload: { status: gameStatus, multiplier: crashPoint.toFixed(2), finalSeed: serverSeed }
        });

        // Wait before next round
        await new Promise(res => setTimeout(res, 4000)); 
    }
}

// FIX 3: TypeScript ke types hata diye
async function resolveBets(roundId, finalCrash) {
    // Mark pending bets as lost
    await supabase.from('bets')
        .update({ status: 'lost' })
        .eq('round_id', roundId)
        .eq('status', 'pending');
}

startGameLoop();