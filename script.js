import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, addDoc, collection, serverTimestamp, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCpS_rr77wh23C2LYl6xCSTyptMKlITauk",
    authDomain: "dukaan-platform.firebaseapp.com",
    projectId: "dukaan-platform",
    storageBucket: "dukaan-platform.firebasestorage.app",
    messagingSenderId: "75765851780",
    appId: "1:75765851780:web:b6782abb897594b89c84d1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
window.db = db;

let loginHandled = false;
let loginLoading = false;

/* === GLOBAL VARIABLES === */
const COIN_RATE = 100; 
const COOLDOWN_MS = 3 * 60 * 1000; 
const SPIN_REFILL_MS = 3 * 60 * 60 * 1000; 
const MAX_DAILY_COINS = 5000;

let admobLoaded = false;
let lastAdTime = 0; 
let timerInterval = null;
let withdrawLock = false; 
let referralLock = false;
let rewardLock = false; 
let toastTimeout;
let saving = false;
let coinSaveTimeout;
let appLoaded = false;
let lastCoinRewardTime = 0;

let serverTimeOffset = 0;
let isTimeLocked = true;

setTimeout(() => {
    if (window.Capacitor) {
        const webSec = document.getElementById('web-login-section');
        const appSec = document.getElementById('app-login-section');
        if(webSec) webSec.style.display = 'none';
        if(appSec) appSec.style.display = 'block';
    }
}, 200);

async function syncSecureTime() {
    try {
        const response = await fetch("https://worldtimeapi.org/api/timezone/Etc/UTC");
        if (!response.ok) throw new Error("API 1 down");
        const data = await response.json();
        serverTimeOffset = new Date(data.datetime).getTime() - Date.now();
        isTimeLocked = false;
    } catch (error) {
        try {
            const response2 = await fetch("https://timeapi.io/api/Time/current/zone?timeZone=UTC");
            if (!response2.ok) throw new Error("API 2 down");
            const data2 = await response2.json();
            serverTimeOffset = new Date(data2.dateTime).getTime() - Date.now();
            isTimeLocked = false;
        } catch(e) {
            isTimeLocked = true;
        }
    }
    updateTimersUI(); 
}

window.getTrueTime = function() {
    return Date.now() + serverTimeOffset;
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        isTimeLocked = true;
        updateTimersUI();
    } else {
        syncSecureTime();
    }
});

let lastLoad = sessionStorage.getItem("lastLoad");
let nowTime = Date.now();
sessionStorage.setItem("lastLoad", nowTime);

function safeLoadState(){
    try{ const saved = localStorage.getItem('earnx_state'); return saved ? JSON.parse(saved) : null;
    }catch{ localStorage.removeItem('earnx_state'); return null; }
}

async function init() {
    if(appLoaded) return;
    appLoaded = true;
    await syncSecureTime(); 

    const saved = safeLoadState();
    if(saved) window.state = saved;

    if(!window.state){
        window.state = {
            user:null,
            tasks:{ lastWatch:0,lastStay:0,lastTap:0,tapCount:0,checkInTime:0 },
            spin:{ spinsLeft:5,lastRefill:0,totalSpins:0 },
            withdrawals:[]
        };
    }

    if(!window.state.spin.lastRefill && window.state.spin.spinsLeft < 5){
        window.state.spin.lastRefill = window.getTrueTime();
    }

    window.updateUI();
    window.nav('login');
}

document.addEventListener("DOMContentLoaded", () => {
    init();
    setTimeout(() => {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) {
            window.Capacitor.Plugins.AdMob.initialize().catch(e => console.log("AdMob Init Error"));
        }
    }, 1000);
});

window.addEventListener("storage", (e) => { if(e.key === "earnx_state") location.reload(); });
window.addEventListener("beforeunload", () => { if(timerInterval) clearInterval(timerInterval); });

window.handleSuccessfulLogin = async function(user) {
    try {
        window.currentUser = user;
        const ref = doc(db, "earnx_users", user.uid);
        const snap = await getDoc(ref);

        let deviceId = localStorage.getItem("earnx_device_id");
        if(!deviceId){
            deviceId = "DEV_" + Math.random().toString(36).substring(2, 15);
            localStorage.setItem("earnx_device_id", deviceId);
        }

        const defaultTasks = { lastWatch:0, lastStay:0, lastTap:0, tapCount:0, checkInTime:0 };
        const defaultSpin = { spinsLeft:5, lastRefill:0, totalSpins:0 };

        if(!snap.exists()){
            const newRefCode = user.uid.substring(0,4).toUpperCase() + Math.floor(Math.random()*9000+1000);
            const data = {
                coins: 0,
                refCode: newRefCode,
                deviceId: deviceId,
                createdAt: window.getTrueTime(),
                tasks: defaultTasks,
                spin: defaultSpin
            };
            await setDoc(ref, data);
            
            window.state.user = { id: user.uid, phone: user.email, coins: 0, refCode: newRefCode, referredBy: false };
            window.state.tasks = defaultTasks;
            window.state.spin = defaultSpin;
        } else {
            const data = snap.data();
            window.state.user = {
                ...(window.state.user || {}),
                id: user.uid,
                phone: user.email,
                coins: data.coins || 0,
                refCode: data.refCode,
                referredBy: data.referredBy || false
            };
            window.state.tasks = data.tasks || defaultTasks;
            window.state.spin = data.spin || defaultSpin;
        }

        window.saveState();
        window.nav('home'); 
        window.startTimers();
        window.loadWithdrawals();
        window.showToast("Login Successful");
    } catch (error) {
        window.showToast("Connection error, please try again.");
    } finally {
        loginLoading = false;
    }
};

onAuthStateChanged(auth, async (user) => {
    if(user && !loginHandled){
        loginHandled = true;
        if(!window.state){
            window.state = {
                user: null,
                tasks: { lastWatch:0,lastStay:0,lastTap:0,tapCount:0,checkInTime:0 },
                spin: { spinsLeft:5,lastRefill:0,totalSpins:0 },
                withdrawals: []
            };
        }
        await window.handleSuccessfulLogin(user);
    } else if (!user) {
        loginHandled = false;
    }
});

window.loginWithGoogle = async function(){
    if(loginLoading) return;
    loginLoading = true;
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        await window.handleSuccessfulLogin(result.user);
    } catch(err) {
        if (err.code !== 'auth/popup-closed-by-user') window.showToast("Login Error. Try again.");
        loginLoading = false;
    }
};

window.loginWithEmail = async function() {
    if(loginLoading) return;
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value.trim();
    if(!email || !password) return window.showToast("Enter Email and Password");
    if(password.length < 6) return window.showToast("Password must be at least 6 characters");
    loginLoading = true;
    window.showToast("Authenticating...");
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        await window.handleSuccessfulLogin(result.user);
    } catch(err) {
        if(err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials') {
            try {
                window.showToast("Creating new account...");
                const result = await createUserWithEmailAndPassword(auth, email, password);
                await window.handleSuccessfulLogin(result.user);
            } catch(regErr) {
                if (regErr.code === 'auth/email-already-in-use') {
                    window.showToast("Account exists. Use 'Forgot Password'.");
                } else {
                    window.showToast("Registration failed");
                }
                loginLoading = false;
            }
        } else {
            window.showToast("Login failed");
            loginLoading = false;
        }
    }
};

window.resetPassword = async function() {
    const email = document.getElementById('email-input').value.trim();
    if(!email) return window.showToast("Please enter your email above first.");
    try {
        await sendPasswordResetEmail(auth, email);
        window.showToast("Password Reset Link sent to your Email!");
    } catch(err) {
        window.showToast("Could not send link");
    }
};

function sanitizeCoins(){
    if(!window.state || !window.state.user) return;
    let c = Number(window.state.user.coins);
    if(isNaN(c) || c < 0) c = 0;
    window.state.user.coins = c;
}

function validateState(){
    if(!window.state || !window.state.user) return;
    if(window.state.user.coins > 1000000) window.state.user.coins = 0;
}

async function saveCoinsToFirebase(){
    if(!navigator.onLine || !window.state.user || !window.state.user.id || saving) return;
    saving = true;
    try {
        const ref = doc(window.db, "earnx_users", window.state.user.id);
        await updateDoc(ref, { coins: Number(window.state.user.coins) || 0, tasks: window.state.tasks || {}, spin: window.state.spin || {} });
    } catch(e) {}
    saving = false;
}

function saveCoinsToFirebaseDebounced(){
    clearTimeout(coinSaveTimeout); coinSaveTimeout = setTimeout(()=>{ saveCoinsToFirebase(); }, 2000);
}

window.saveState = function() {
    sanitizeCoins(); validateState();
    localStorage.setItem('earnx_state', JSON.stringify(window.state));
    window.updateUI(); saveCoinsToFirebaseDebounced();
}

window.nav = function(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`screen-${screenId}`);
    if(target) target.classList.add('active');
    
    const bNav = document.getElementById('bottom-nav');
    if (bNav) {
        if (['login'].includes(screenId)) bNav.style.display = 'none';
        else bNav.style.display = 'flex';
    }
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const activeItem = document.querySelector(`.nav-item[data-target="${screenId}"]`);
    if(activeItem) activeItem.classList.add('active');
}

window.logout = function() {
    signOut(auth).then(() => { window.currentUser = null; localStorage.clear(); location.reload(); });
}

function debounce(fn, delay=300){
    let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), delay); }
}

window.loadWithdrawals = debounce(async function(){
    if(!window.currentUser) return;
    try {
        const q = query(collection(window.db, "earnx_withdrawals"), where("userId", "==", window.currentUser.uid));
        const snap = await getDocs(q);
        window.state.withdrawals = [];
        snap.forEach(doc=>{
            const d = doc.data();
            window.state.withdrawals.push({ amount: (d.coins / 10000) * 100, upi: d.upiId, date: d.createdAt ? (d.createdAt.seconds * 1000) : window.getTrueTime(), status: d.status });
        });
        window.saveState();
    } catch(e) {}
}, 300);

function safeSetText(id, value){ const el = document.getElementById(id); if(el) el.innerText = value; }

const updateUICore = function() {
    if(!window.state || !window.state.user) return;
    sanitizeCoins();
    document.querySelectorAll('.global-coin-display').forEach(el => { el.innerText = window.state.user.coins.toLocaleString(); });
    safeSetText('rupee-display', (window.state.user.coins / (10000 / COIN_RATE)).toFixed(2));
    safeSetText('profile-phone', window.state.user.phone);
    safeSetText('profile-uid', window.state.user.id);
    safeSetText('my-ref-code', window.state.user.refCode);
    safeSetText('tap-count', window.state.tasks.tapCount);
    safeSetText('spin-count-display', window.state.spin.spinsLeft);

    if(window.state.user.referredBy){
        const el = document.getElementById('enter-ref-section');
        if(el) el.style.display = 'none';
    }

    renderWithdrawals();

    const btnCheckin = document.getElementById('btn-checkin');
    if(btnCheckin){
        const last = window.state.tasks.checkInTime || 0;
        if(window.getTrueTime() - last < 86400000){
            btnCheckin.disabled = true; btnCheckin.innerText = "Claimed";
        } else {
            btnCheckin.disabled = false; btnCheckin.innerText = "Claim 50";
        }
    }
}
window.updateUI = debounce(updateUICore, 50);

function renderWithdrawals() {
    const list1 = document.getElementById('my-withdrawals-list');
    const list2 = document.getElementById('home-withdrawals-list');
    if(!window.state || !window.state.withdrawals) return;
    if(window.state.withdrawals.length === 0) {
        if(list1) list1.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No withdrawals yet.</p>';
        if(list2) list2.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No recent activity.</p>';
        return;
    }

    let htmlContent = '';
    const sorted = [...window.state.withdrawals].sort((a,b) => b.date - a.date); 
    sorted.forEach(w => {
        const dateStr = new Date(w.date).toLocaleDateString();
        const maskedUpi = maskUPI(w.upi);
        let statusClass = 'status-pending';
        if(w.status === 'Approved') statusClass = 'text-green';
        if(w.status === 'Rejected') statusClass = 'text-danger';
        htmlContent += `<div class="history-item"><div class="h-info"><span class="h-upi">₹${w.amount} &rarr; ${maskedUpi}</span><span class="h-time">${dateStr}</span></div><div class="h-status ${statusClass}" style="${w.status === 'Approved' || w.status === 'Rejected' ? 'background:transparent; padding:0;' : ''}">${w.status}</div></div>`;
    });
    if(list1) list1.innerHTML = htmlContent; if(list2) list2.innerHTML = htmlContent; 
}

function maskUPI(upi) {
    if(!upi || !upi.includes('@')) return upi;
    const parts = upi.split('@'); return parts[0].substring(0, 2) + "****@" + parts[1];
}

window.showToast = function(msg) {
    const toast = document.getElementById('toast'); if(!toast) return;
    clearTimeout(toastTimeout); toast.innerText = msg; toast.style.display = 'block';
    toastTimeout = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

function rewardCoins(amount, msg) {
    if(rewardLock) return; rewardLock = true;
    setTimeout(()=> rewardLock = false, 2000);

    if(!navigator.onLine) return window.showToast("No internet");
    if(!window.state || !window.state.user) return window.showToast("Login required");
    if(amount <= 0 || amount > 200) return window.showToast("Invalid reward");

    const now = window.getTrueTime();
    if(now - lastCoinRewardTime < 10000) return;
    lastCoinRewardTime = now;

    let today = new Date().toDateString();
    if(window.state.lastRewardDate !== today){ window.state.dailyCoins = 0; window.state.lastRewardDate = today; }
    if((window.state.dailyCoins || 0) >= MAX_DAILY_COINS) return window.showToast("Daily limit reached");

    window.state.dailyCoins += amount; window.state.user.coins += amount;
    window.saveState(); window.showToast(`${amount} Coins Added`);
}

async function showAd(callback) {
    if(isTimeLocked) return window.showToast("Please ensure correct phone time & active internet.");
    
    if(window.getTrueTime() - lastAdTime < 60000){
        window.showToast("Wait 1 min before next ad");
        return;
    }

    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob) {
        try {
            window.showToast("Loading Ad...");
            const { AdMob } = window.Capacitor.Plugins;
            const adId = "ca-app-pub-6519206650027176/8005768127"; 

            await AdMob.prepareRewardVideoAd({ adId: adId });

            let listener = AdMob.addListener('onRewardedVideoAdRewarded', (rewardItem) => {
                lastAdTime = window.getTrueTime();
                if(callback) callback();
                
                if (listener && listener.remove) {
                    listener.remove();
                } else {
                    AdMob.removeAllListeners();
                }
            });

            await AdMob.showRewardVideoAd();

        } catch (error) {
            window.showToast("Ad not available right now.");
        }
    } else {
        window.showToast("App not running on Mobile!");
    }
}

window.dailyCheckIn = function() {
    if(isTimeLocked) return window.showToast("Securing Time... Please check internet & clock.");
    const last = window.state.tasks.checkInTime || 0;
    if(window.getTrueTime() - last < 86400000) return window.showToast("Already claimed today");
    window.state.tasks.checkInTime = window.getTrueTime();
    rewardCoins(50, "Daily Check-in");
}

window.doWatchTask = function() {
    if(isTimeLocked) return window.showToast("Securing Time... Please check internet & clock.");
    if(window.getTrueTime() - window.state.tasks.lastWatch < COOLDOWN_MS) return window.showToast("Wait for timer!");
    showAd(() => { window.state.tasks.lastWatch = window.getTrueTime(); rewardCoins(100, "Watched Ad"); updateTimersUI(); });
}

window.doStayTask = function() {
    if(isTimeLocked) return window.showToast("Securing Time... Please check internet & clock.");
    if(window.getTrueTime() - window.state.tasks.lastStay < COOLDOWN_MS) return window.showToast("Wait for timer!");
    showAd(() => {
        const sModal = document.getElementById('stay-modal'); const sTime = document.getElementById('stay-countdown');
        if(!sModal || !sTime) return;
        sModal.style.display = 'flex'; let timeLeft = 15; sTime.innerText = timeLeft;
        const sInt = setInterval(() => {
            timeLeft--; sTime.innerText = timeLeft;
            if(timeLeft <= 0) {
                clearInterval(sInt); sModal.style.display = 'none';
                window.state.tasks.lastStay = window.getTrueTime();
                rewardCoins(200, "Stay Task Complete"); updateTimersUI();
            }
        }, 1000);
    });
}

window.doTapTask = function() {
    if(isTimeLocked) return window.showToast("Securing Time... Please check internet & clock.");
    if(!window.state || !window.state.tasks) return;
    if(window.state.tasks.tapCount >= 20) return;
    if(window.getTrueTime() - window.state.tasks.lastTap < COOLDOWN_MS) return window.showToast("Wait for timer!");

    let next = window.state.tasks.tapCount + 1;
    if(next === 10){
        if(window.getTrueTime() - lastAdTime < 60000) return window.showToast("Wait 1 min for next Ad");
        showAd(()=>{});
    }
    window.state.tasks.tapCount++;
    if(window.state.tasks.tapCount >= 20){
        window.state.tasks.tapCount = 0; window.state.tasks.lastTap = window.getTrueTime(); rewardCoins(150, "Tap Task");
    }
    window.saveState();
}

const prizeMap = [100, 75, 50, 20, 10, 5]; 
window.spinWheel = function() {
    if(isTimeLocked) return window.showToast("Securing Time... Please check internet & clock.");
    const btn = document.getElementById('btn-spin');
    if(!btn || btn.disabled) return; 
    if(window.state.spin.spinsLeft <= 0) return window.showToast("No spins left.");
    
    btn.disabled = true;
    window.state.spin.spinsLeft--; window.state.spin.totalSpins++;
    if(window.state.spin.spinsLeft === 4) window.state.spin.lastRefill = window.getTrueTime();
    window.saveState();

    const safeRandom = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / (2**32) * 6);
    const targetDeg = (360 * 5) + (360 - (safeRandom * 60)) + (Math.random() * 40 - 20);
    const wheel = document.getElementById('wheel-inner');
    if(wheel) {
        wheel.style.transition = 'none'; wheel.style.transform = `rotate(0deg)`; void wheel.offsetWidth;
        wheel.style.transition = 'transform 4s cubic-bezier(0.25, 0.1, 0.25, 1)'; wheel.style.transform = `rotate(${targetDeg}deg)`;
    }

    setTimeout(() => {
        rewardCoins(prizeMap[safeRandom], "Spin Wheel");
        if(window.state.spin.totalSpins % 3 === 0) {
            if(window.getTrueTime() - lastAdTime >= 60000) { setTimeout(() => showAd(), 500); }
        }
    }, 4200);
    setTimeout(() => { btn.disabled = false; }, 4500);
}

window.copyReferral = function() {
    const code = window.state.user.refCode;
    navigator.clipboard.writeText(code).then(() => { window.showToast("Code Copied: " + code);
    }).catch(() => {
        const t = document.createElement("textarea"); t.value = code; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); window.showToast("Code Copied!");
    });
}

window.shareReferral = async function() {
    const code = window.state.user.refCode; const shareLink = "https://dukaan-platform.firebaseapp.com"; 
    const text = `Hey! Join EarnX and earn real rewards. Use my code: ${code}\nLink: ${shareLink}`;
    
    try {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share) {
            await window.Capacitor.Plugins.Share.share({ title: 'EarnX Rewards', text: text, url: shareLink, dialogTitle: 'Share EarnX with friends' });
        } else if (navigator.share) {
            await navigator.share({ title: 'EarnX Rewards', text: text, url: shareLink });
        } else { throw new Error("Share not supported"); }
    } catch(e) { window.copyReferral(); window.showToast("Code Copied! Share link manually."); }
}

window.applyReferralFirebase = async function(){
    if(referralLock) return; referralLock = true;
    try {
        if(!navigator.onLine) return window.showToast("No internet connection");
        if(!window.state.user) return window.showToast("Login first");

        const el = document.getElementById('ref-input'); if(!el) return;
        const code = el.value.trim().toUpperCase();

        if(!code) return window.showToast("Enter code");
        if(window.state.user.referredBy === true) return window.showToast("Already used referral");
        if(code === window.state.user.refCode.toUpperCase()) return window.showToast("Cannot use your own code");

        const q = query(collection(window.db, "earnx_users"), where("refCode", "==", code));
        const snapshot = await getDocs(q);

        if(snapshot.empty){ window.showToast("Invalid code"); return; }
        const refDoc = snapshot.docs[0]; const refData = refDoc.data();

        let currentDevice = localStorage.getItem("earnx_device_id");
        if(refData.deviceId && refData.deviceId === currentDevice) { window.showToast("Fraud detected!"); return; }

        await updateDoc(doc(window.db, "earnx_users", refDoc.id), { coins: (Number(refData.coins) || 0) + 100 });
        window.state.user.coins += 100; window.state.user.referredBy = true;
        window.saveState(); window.showToast("Referral applied +100 coins"); el.value = "";
    } catch(e) { window.showToast("Error applying referral");
    } finally { referralLock = false; }
}

window.submitWithdraw = async function(){
    if(withdrawLock) return; withdrawLock = true;
    setTimeout(()=> withdrawLock = false, 5000); 
    try {
        if(!navigator.onLine) return window.showToast("No internet");
        const coins = Math.floor(window.state.user.coins / 10000) * 10000;
        if(coins < 10000) return window.showToast("Min 10k coins");

        const input = document.getElementById('upi-input'); const upi = input.value.trim();
        if(!/^[a-zA-Z0-9._-]+@[a-zA-Z]{3,}$/.test(upi)) return window.showToast("Invalid UPI");

        const userRef = doc(window.db, "earnx_users", window.currentUser.uid);
        const snap = await getDoc(userRef);
        const currentCoins = snap.data().coins || 0;

        if(currentCoins < coins) return window.showToast("Balance mismatch");

        await updateDoc(userRef, { coins: currentCoins - coins });
        await addDoc(collection(window.db, "earnx_withdrawals"), { userId: window.currentUser.uid, coins: coins, upiId: upi, status: "Pending", createdAt: serverTimestamp() });

        window.state.user.coins -= coins; window.saveState(); window.loadWithdrawals();
        input.value = ""; window.showToast("Withdraw Requested");
    } catch(e){ window.showToast("Withdraw failed"); }
};

window.startTimers = function() {
    if(timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimersUI, 1000);
    updateTimersUI();
}

function updateTimersUI() {
    if(isTimeLocked) {
        safeSetText('watch-timer-display', "Syncing...");
        safeSetText('stay-timer-display', "Syncing...");
        safeSetText('tap-timer-display', "Syncing...");
        return;
    }

    const now = window.getTrueTime();
    updateSingleTimer('watch', window.state.tasks.lastWatch, now);
    updateSingleTimer('stay', window.state.tasks.lastStay, now);
    updateSingleTimer('tap', window.state.tasks.lastTap, now);

    if(window.state.spin.spinsLeft < 5 && window.state.spin.lastRefill > 0) {
        const passed = now - window.state.spin.lastRefill;
        if(passed >= SPIN_REFILL_MS) {
            window.state.spin.spinsLeft = 5; window.state.spin.lastRefill = 0; window.saveState();
        } else { safeSetText('spin-refill-timer', "Refill in: " + formatMS(SPIN_REFILL_MS - passed)); }
    } else { safeSetText('spin-refill-timer', ""); }
}

function updateSingleTimer(type, lastTime, now) {
    const btn = document.getElementById(`btn-${type}`); if(!btn) return;
    const passed = now - lastTime;
    if(passed < COOLDOWN_MS) {
        safeSetText(`${type}-timer-display`, formatMS(COOLDOWN_MS - passed)); btn.disabled = true;
    } else {
        if(type === 'tap' && window.state.tasks.tapCount >= 20) { safeSetText(`${type}-timer-display`, "Complete"); btn.disabled = true;
        } else { safeSetText(`${type}-timer-display`, "Ready"); btn.disabled = false; }
    }
}

function formatMS(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60); const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}
