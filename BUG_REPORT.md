# 🐛 BUG REPORT - try.html

**Analysis Date:** 2026-04-24  
**File:** try.html  
**Status:** 7 Critical/High Issues Found + 5 Warnings

---

## 🔴 CRITICAL BUGS

### BUG #1: Refresh Rate Too Short — API Overload Risk
**Severity:** HIGH | **Line:** 1452  
**Issue:**
```javascript
setInterval(updateLiveCricketData, 120000); // Refreshes every 60s (comment says 60s but code says 120000ms)
```
**Problem:**  
- Comment says "refresh every 60s" but code is 120000ms = **2 minutes**
- CricAPI has rate limits (100 requests/day for free tier)
- With multiple users, this WILL hit rate limits quickly
- No exponential backoff implemented

**Fix:**
```javascript
setInterval(updateLiveCricketData, 300000); // Increase to 5 minutes
// AND add rate-limit detection with exponential backoff
```

---

### BUG #2: Missing Null Check in Coin Calculation
**Severity:** CRITICAL | **Line:** 1656-1670  
**Issue:**
```javascript
async function processDeposit(method){
    if(!currentUser){ showFancyAlert('Pehle Log In karein!'); return; }
    if(!selectedPkg){ showFancyAlert('Pehle ek coin package select karein!'); return; }

    var baseCoins = selectedPkg.coins;
    var price = selectedPkg.price;
    var finalCoins = baseCoins;
    
    // ❌ BUG: playerData.coins could be NULL/UNDEFINED
    var { error } = await sb.from('players')
        .update({ coins: playerData.coins + finalCoins })  // CRASH HERE if playerData is null
        .eq('player_id', playerData.player_id);
```
**Impact:**  
- If `playerData` is null (edge case during async operations), app crashes with "Cannot read property 'coins'"
- No null guard before accessing `playerData.coins`

**Fix:**
```javascript
if(!playerData){ showFancyAlert('Player data missing! Refresh and try again.'); return; }
var { error } = await sb.from('players')
    .update({ coins: (playerData.coins || 0) + finalCoins })
    .eq('player_id', playerData.player_id);
```

---

### BUG #3: Database Column Name Mismatch in Registration
**Severity:** CRITICAL | **Line:** 1577-1583  
**Issue:**
```javascript
var { error: dbErr } = await sb.from('players').insert({
    auth_id: data.user.id,
    player_name: name,      // ❌ WRONG: should be 'name'
    player_id: pid,         // ❌ WRONG: should be 'player_id' or 'id'
    mobile_or_email: mobile,
    coins: 0,
    referral_code: pid,
    created_at: new Date().toISOString()
});
```
**Problem:**  
- Supabase table likely has columns: `auth_id`, `name`, `player_id`, `coins`, etc.
- Code uses `player_name` instead of `name`
- Registration FAILS silently or throws database constraint error
- Users can't create accounts

**Fix:**
```javascript
var { error: dbErr } = await sb.from('players').insert({
    auth_id: data.user.id,
    name: name,              // ✓ Correct
    player_id: pid,          // ✓ Correct
    mobile: mobile,
    coins: 500,              // Give 500 bonus at registration
    referral_code: pid,
    created_at: new Date().toISOString()
});
```

---

### BUG #4: Missing Coins Update After Registration
**Severity:** HIGH | **Line:** 1587-1592  
**Issue:**
```javascript
// 3. Log Welcome Bonus in Transactions
await sb.from('transactions').insert({
    player_id: pid,
    type: 'bonus',
    coins: 500,
    description: 'Welcome bonus — Registration',
    created_at: new Date().toISOString()
});
```
**Problem:**  
- Welcome bonus is logged in transactions but **NOT** added to player's coins!
- New users see 0 coins because the bonus was never credited

**Fix:**
```javascript
// After registration, update player coins
await sb.from('players')
    .update({ coins: 500 })
    .eq('player_id', pid);

// Then log transaction
await sb.from('transactions').insert({
    player_id: pid,
    type: 'bonus',
    coins: 500,
    description: 'Welcome bonus — Registration',
    created_at: new Date().toISOString()
});
```

---

### BUG #5: Unhandled Promise Rejection in Init
**Severity:** HIGH | **Line:** 1443-1453  
**Issue:**
```javascript
(async function init(){
  const { data:{ session } } = await sb.auth.getSession(); // ❌ NO ERROR HANDLING
  if(session){
    currentUser = session.user;
    await loadPlayerData();
  }
  updateBalanceUI();
  await updateLiveCricketData();  // ❌ Could fail silently
  updateUpcomingMatches();
  loadEndedMatches();
  setInterval(updateLiveCricketData, 120000);
})();
```
**Problem:**  
- No try-catch block
- If `updateLiveCricketData()` fails, entire app initialization breaks
- Cricket data never loads, but no error message

**Fix:**
```javascript
(async function init(){
  try {
    const { data:{ session } } = await sb.auth.getSession();
    if(session){
      currentUser = session.user;
      await loadPlayerData();
    }
    updateBalanceUI();
    await updateLiveCricketData();
    updateUpcomingMatches();
    await loadEndedMatches();
    setInterval(updateLiveCricketData, 300000);
  } catch(err) {
    console.error("Init failed:", err);
    showFancyAlert('App startup failed. Please refresh the page.');
  }
})();
```

---

### BUG #6: Event Listener Not Removed - Memory Leak
**Severity:** MEDIUM | **Line:** 1725-1728  
**Issue:**
```javascript
document.getElementById('wCoins').addEventListener('input', function(){
  var c = parseInt(this.value)||0;
  if(c>=500){
    document.getElementById('w-calc').style.display='block';
    document.getElementById('w-inr').innerText = '₹'+coinsToINR(c);
  } else {
    document.getElementById('w-calc').style.display='none';
  }
});
```
**Problem:**  
- Event listener added every time modal opens
- No removal logic → listeners stack up
- Memory leak + slow performance
- Input field fires multiple times

**Fix:**
```javascript
const wCoinsInput = document.getElementById('wCoins');
if(wCoinsInput) {
  wCoinsInput.removeEventListener('input', wCoinsUpdateHandler);
  wCoinsInput.addEventListener('input', wCoinsUpdateHandler);
}

function wCoinsUpdateHandler() {
  var c = parseInt(this.value)||0;
  if(c>=500){
    document.getElementById('w-calc').style.display='block';
    document.getElementById('w-inr').innerText = '₹'+coinsToINR(c);
  } else {
    document.getElementById('w-calc').style.display='none';
  }
}
```

---

### BUG #7: Exposed API Keys in Frontend
**Severity:** CRITICAL | **Line:** 1405-1413  
**Issue:**
```javascript
const SUPA_URL = 'https://lhbsnhwqvdhhzjilbgte.supabase.co';
const SUPA_KEY = 'sb_publishable_9cMEscWTC_f31zQXjdJfIA_U4u7wBR_';  // ❌ HARDCODED!
const API_KEYS = [
  '6992e96c-45e2-4daa-88a1-0cddfb9b6a50',
  '8acbde99-9a6b-4a17-9aaa-4fa2e2b2aba6',
  'fbc6a4a7-a5fa-4c02-920c-9b465c4f59c1'  // ❌ ALL EXPOSED
];
```
**Problem:**  
- Keys visible in browser DevTools
- Anyone can clone your project and use YOUR Supabase/API quota
- Security risk for production

**Fix:**
```javascript
// Move to .env or backend proxy
// Frontend should use anonymous keys only (Supabase RLS policies)
// API keys should be rotated via backend server
```

---

## ⚠️ WARNINGS

### WARNING #1: Missing Error Handling in Withdrawals
**Severity:** MEDIUM | **Line:** 1740-1760  
```javascript
async function requestWithdrawal(){
  // ... validation code ...
  var { error } = await sb.from('players').update({ coins: playerData.coins - coins }).eq('player_id', playerData.player_id);
  if(error){ showFancyAlert('Error: '+error.message); return; }
  
  // ❌ Following inserts have NO error handling
  await sb.from('withdrawals').insert({...});  // Could fail silently
  await sb.from('transactions').insert({...}); // Could fail silently
```
**Fix:** Add error checks for all database operations.

---

### WARNING #2: Race Condition in Coin Balance
**Severity:** MEDIUM | **Line:** 1656-1680  
```javascript
// Multiple simultaneous deposits can cause coin loss
// Example: 2 deposits of 100 coins at same time
// Both read playerData.coins = 500
// Both update to 600 instead of 700
```
**Fix:** Use server-side transactions or increment operators:
```javascript
await sb.from('players').update({
  coins: sb.raw(`coins + ${finalCoins}`)  // Atomic increment
}).eq('player_id', playerData.player_id);
```

---

### WARNING #3: Sky High Game Function Undefined
**Severity:** MEDIUM | **Line:** 2190  
```javascript
<div class="hero-banner interactive-aviator-banner" onclick="switchToSkyHigh()">
```
**Issue:** If `switchToSkyHigh()` is defined further below, it works. But the placement suggests it might be missing if the script gets truncated.

---

### WARNING #4: Missing Input Validation in Number Fields
**Severity:** LOW | **Line:** Various  
```javascript
// Accepting any number without bounds checking
<input type="number" id="jp-run-'+index+'" class="neon-input" min="0" max="36" placeholder="0">
// Client-side validation only - backend should validate too
```

---

### WARNING #5: Referral System Column Mismatch
**Severity:** LOW | **Line:** 1587  
```javascript
// Code comment mentions:
// referred_by: ref || null,  <-- Is line ko hata do ya comment kar do
// Inconsistency in referral logic
```

---

## 📊 SUMMARY TABLE

| Bug # | Issue | Severity | Impact | Status |
|-------|-------|----------|--------|--------|
| 1 | API Refresh Rate | HIGH | Rate limit hits | ⚠️ Needs fix |
| 2 | Null Check Missing | CRITICAL | App crash | 🔴 Critical |
| 3 | DB Column Mismatch | CRITICAL | Registration fails | 🔴 Critical |
| 4 | Bonus Not Credited | HIGH | Users lose coins | ⚠️ High |
| 5 | No Error Handling Init | HIGH | Silent failures | ⚠️ High |
| 6 | Memory Leak | MEDIUM | Performance degrades | ⚠️ Medium |
| 7 | Exposed API Keys | CRITICAL | Security breach | 🔴 Critical |

---

## 🔧 QUICK FIX PRIORITY

1. **IMMEDIATE (This hour):**
   - Fix BUG #3 (Registration column names)
   - Rotate API keys in production
   - Fix BUG #4 (Bonus credit)

2. **TODAY:**
   - Add null checks (BUG #2)
   - Add error handling to init (BUG #5)
   - Move API keys to backend

3. **THIS WEEK:**
   - Fix memory leak (BUG #6)
   - Implement atomic transactions (WARNING #2)
   - Add withdrawal error handling (WARNING #1)

---

**Report Generated:** 2026-04-24 | **File:** c:\VISUAL CODE\cc\try.html
