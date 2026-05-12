"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supabase_js_1 = require("@supabase/supabase-js");
const crypto_1 = __importDefault(require("crypto"));
// Configuration
const supabase = (0, supabase_js_1.createClient)('https://ymmixcalloktrohxkswk.supabase.co', 'sb_publishable_TkYwktWZWyRe-V5JHYXXgw_SoYtHBUy');
const HOUSE_EDGE = 0.03;
const PROMO_MODE = false;
let currentRoundId = null;
let currentMultiplier = 1.0;
let gameStatus = 'waiting';
let crashPoint = 0;
/**
 * Generates a provably fair crash point using HMAC-SHA256
 */
function generateProvablyFairCrash(promoOverride) {
    if (PROMO_MODE && promoOverride) {
        return { serverSeed: '', clientSeed: '', hash: '', point: promoOverride };
    }
    const serverSeed = crypto_1.default.randomBytes(32).toString('hex');
    const clientSeed = crypto_1.default.randomBytes(16).toString('hex');
    const hash = crypto_1.default.createHmac('sha256', serverSeed).update(clientSeed).digest('hex');
    const n = parseInt(hash.substring(0, 8), 16);
    const float = n / 4294967296;
    const point = Math.max(1.00, Math.floor((100 / (1 - float)) * (1 - HOUSE_EDGE)) / 100);
    return { serverSeed, clientSeed, hash, point };
}
function startGameLoop() {
    return __awaiter(this, void 0, void 0, function* () {
        while (true) {
            // 1. Setup Round
            gameStatus = 'waiting';
            const { serverSeed, clientSeed, hash, point } = generateProvablyFairCrash(null);
            crashPoint = point;
            const { data, error } = yield supabase.from('game_rounds')
                .insert({ server_seed: serverSeed, client_seed: clientSeed, hash, status: 'pending' })
                .select()
                .single();
            const round = data;
            currentRoundId = round ? round.id : null;
            // Broadcast waiting
            supabase.channel('game_state').send({
                type: 'broadcast',
                event: 'tick',
                payload: { status: gameStatus, timeToStart: 5000, hash }
            });
            yield new Promise(res => setTimeout(res, 5000));
            // 2. Start Flight
            if (currentRoundId) {
                gameStatus = 'playing';
                yield supabase.from('game_rounds')
                    .update({ status: 'active', started_at: new Date().toISOString() })
                    .eq('id', currentRoundId);
                let startTime = Date.now();
                currentMultiplier = 1.0;
                while (currentMultiplier < crashPoint) {
                    const elapsedTime = Date.now() - startTime;
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
                    yield new Promise(res => setTimeout(res, 100));
                }
                // 3. Crash
                gameStatus = 'crashed';
                yield supabase.from('game_rounds').update({
                    status: 'crashed',
                    crash_point: crashPoint
                }).eq('id', currentRoundId);
                yield resolveBets(currentRoundId, crashPoint);
            }
            supabase.channel('game_state').send({
                type: 'broadcast',
                event: 'tick',
                payload: { status: gameStatus, multiplier: crashPoint.toFixed(2), finalSeed: serverSeed }
            });
            yield new Promise(res => setTimeout(res, 4000));
        }
    });
}
function resolveBets(roundId, finalCrash) {
    return __awaiter(this, void 0, void 0, function* () {
        yield supabase.from('bets')
            .update({ status: 'lost' })
            .eq('round_id', roundId)
            .eq('status', 'pending');
    });
}
startGameLoop();
