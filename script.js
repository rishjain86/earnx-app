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
            isTimeLocked = false; // Fallback to device time
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
});

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
        loginLoading = false;
    }
};

window.loginWithEmail = async function() {
    if(loginLoading) return;
    const email = document.getElementById('email-input').value.trim();
    const password = document.getElementById('password-input').value.trim();
    if(!email || !password) return window.showToast("Enter Email and Password");
    loginLoading = true;
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        await window.handleSuccessfulLogin(result.user);
    } catch(err) {
        if(err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
            try {
                const result = await createUserWithEmailAndPassword(auth, email, password);
                await window.handleSuccessfulLogin(result.user);
            } catch(regErr) {
                window.showToast("Registration failed");
                loginLoading = false;
            }
        } else {
            window.showToast("Login failed");
            loginLoading = false;
        }
    }
};

window.saveState = function() {
    localStorage.setItem('earnx_state', JSON.stringify(window.state));
    window.updateUI();
    clearTimeout(coinSaveTimeout);
    coinSaveTimeout = setTimeout(async ()=>{
        if(window.state.user && window.state.user.id){
            const ref = doc(db, "earnx_users", window.state.user.id);
            await updateDoc(ref, { coins: window.state.user.coins, tasks: window.state.tasks, spin: window.state.spin });
        }
    }, 2000);
}

window.nav = function(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screenId}`).classList.add('active');
    const bNav = document.getElementById('bottom-nav');
    if (bNav) bNav.style.display = (screenId === 'login') ? 'none' : 'flex';
}

window.logout = function() {
    auth.signOut().then(() => { localStorage.clear(); location.reload(); });
}

window.loadWithdrawals = async function(){
    if(!window.currentUser) return;
    const q = query(collection(db, "earnx_withdrawals"), where("userId", "==", window.currentUser.uid));
    const snap = await getDocs(q);
    window.state.withdrawals = [];
    snap.forEach(doc => window.state.withdrawals.push(doc.data()));
    window.updateUI();
}

// 🚀 MONETAG REWARDED AD LOGIC
async function showAd(callback) {
    if(isTimeLocked) return window.showToast("Securing Time...");
    
    // Aapka Monetag Direct Link
    const monetagLink = "https://omg10.com/4/10957927";

    if(window.getTrueTime() - lastAdTime < 60000){
        window.showToast("Wait 1 min before next ad");
        return;
    }

    window.showToast("Opening Ad... Watch for 7 seconds");
    
    // Ad open karna
    window.open(monetagLink, '_blank');

    // 7 seconds delay for reward
    setTimeout(() => {
        lastAdTime = window.getTrueTime();
        if(callback) callback();
        window.showToast("Coins Rewarded! ✓");
    }, 7000); 
}

window.dailyCheckIn = function() {
    const last = window.state.tasks.checkInTime || 0;
    if(window.getTrueTime() - last < 86400000) return window.showToast("Already claimed");
    window.state.tasks.checkInTime = window.getTrueTime();
    window.rewardCoins(50, "Daily Check-in");
}

window.doWatchTask = function() {
    if(window.getTrueTime() - window.state.tasks.lastWatch < COOLDOWN_MS) return window.showToast("Wait for timer!");
    showAd(() => { window.state.tasks.lastWatch = window.getTrueTime(); window.rewardCoins(100, "Watched Ad"); });
}

window.doStayTask = function() {
    if(window.getTrueTime() - window.state.tasks.lastStay < COOLDOWN_MS) return window.showToast("Wait for timer!");
    showAd(() => {
        window.state.tasks.lastStay = window.getTrueTime();
        window.rewardCoins(200, "Stay Task Complete");
    });
}

window.doTapTask = function() {
    if(window.state.tasks.tapCount >= 20) return;
    if(window.getTrueTime() - window.state.tasks.lastTap < COOLDOWN_MS) return window.showToast("Wait for timer!");
    window.state.tasks.tapCount++;
    if(window.state.tasks.tapCount >= 20){
        window.state.tasks.tapCount = 0; window.state.tasks.lastTap = window.getTrueTime(); window.rewardCoins(150, "Tap Task");
    }
    window.saveState();
}

window.spinWheel = function() {
    if(window.state.spin.spinsLeft <= 0) return window.showToast("No spins left.");
    const btn = document.getElementById('btn-spin');
    btn.disabled = true;
    window.state.spin.spinsLeft--;
    window.saveState();
    
    const wheel = document.getElementById('wheel-inner');
    const randomDeg = Math.floor(Math.random() * 360) + 1440;
    wheel.style.transform = `rotate(${randomDeg}deg)`;

    setTimeout(() => {
        window.rewardCoins(50, "Spin Prize");
        btn.disabled = false;
    }, 4000);
}

window.rewardCoins = function(amount, msg) {
    window.state.user.coins += amount;
    window.saveState();
    window.showToast(`${amount} Coins Added`);
}

window.updateUI = function() {
    if(!window.state.user) return;
    document.querySelectorAll('.global-coin-display').forEach(el => el.innerText = window.state.user.coins);
    const rupee = (window.state.user.coins / 100).toFixed(2);
    const rDisplay = document.getElementById('rupee-display');
    if(rDisplay) rDisplay.innerText = rupee;
}

window.showToast = function(msg) {
    const t = document.getElementById('toast');
    t.innerText = msg; t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 3000);
}

window.startTimers = function() {
    setInterval(updateTimersUI, 1000);
}

function updateTimersUI() {
    const now = window.getTrueTime();
    // Simple timer logic...
}
