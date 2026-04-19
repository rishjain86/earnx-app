import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    onAuthStateChanged, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendEmailVerification, 
    signOut 
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    updateDoc, 
    addDoc, 
    collection, 
    serverTimestamp, 
    query, 
    where, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

/* === CONFIGURATION === */
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

const CURRENT_VERSION = "1.0";
const COOLDOWN_WATCH = 15 * 60 * 1000;
const COOLDOWN_STAY = 30 * 60 * 1000;
const COOLDOWN_TAP = 60 * 60 * 1000;
const SPIN_REFILL_MS = 3 * 60 * 60 * 1000;

/* === STATE MANAGEMENT === */
window.state = {
    user: null,
    tasks: { lastWatch: 0, watchHistory: [], lastStay: 0, lastTap: 0, tapCount: 0, checkInTime: 0 },
    spin: { spinsLeft: 5, lastRefill: 0, totalSpins: 0 },
    withdrawals: []
};

let serverTimeOffset = 0;
let isTimeLocked = true;
let lastAdTime = 0;
let loginProcessing = false;

/* === CORE FUNCTIONS === */

async function syncTime() {
    try {
        const res = await fetch("https://worldtimeapi.org/api/timezone/Etc/UTC");
        const data = await res.json();
        serverTimeOffset = new Date(data.datetime).getTime() - performance.now();
        isTimeLocked = false;
        checkVersion();
    } catch (e) {
        serverTimeOffset = Date.now() - performance.now();
        isTimeLocked = false;
    }
}

window.getTrueTime = () => performance.now() + serverTimeOffset;

async function checkVersion() {
    try {
        const snap = await getDoc(doc(db, "earnx_config", "app_settings"));
        if (snap.exists() && snap.data().latest_version !== CURRENT_VERSION) {
            window.updateUrl = snap.data().update_url;
            document.getElementById('update-screen').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
        }
    } catch (e) {}
}

window.showToast = (m) => {
    const t = document.getElementById('toast');
    t.innerText = m;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 3000);
};

/* === AUTHENTICATION === */

window.handleSuccessfulLogin = async (user) => {
    window.currentUser = user;
    const ref = doc(db, "earnx_users", user.uid);
    const snap = await getDoc(ref);

    // Initial values for new users (0 ensures tasks are ready)
    const defaults = {
        tasks: { lastWatch: 0, watchHistory: [], lastStay: 0, lastTap: 0, tapCount: 0, checkInTime: 0 },
        spin: { spinsLeft: 5, lastRefill: 0, totalSpins: 0 }
    };

    if (!snap.exists()) {
        const newCode = user.uid.substring(0, 4).toUpperCase() + Math.floor(Math.random() * 9000 + 1000);
        const data = { 
            coins: 0, 
            refCode: newCode, 
            createdAt: serverTimestamp(), 
            tasks: defaults.tasks, 
            spin: defaults.spin, 
            profile: { name: "", phone: "" } 
        };
        await setDoc(ref, data);
        window.state.user = { id: user.uid, email: user.email, coins: 0, refCode: newCode, profile: { name: "", phone: "" } };
        window.state.tasks = defaults.tasks;
        window.state.spin = defaults.spin;
    } else {
        const d = snap.data();
        window.state.user = { 
            id: user.uid, 
            email: user.email, 
            coins: d.coins || 0, 
            refCode: d.refCode, 
            referredBy: d.referredBy, 
            profile: d.profile || { name: "", phone: "" } 
        };
        window.state.tasks = d.tasks || defaults.tasks;
        window.state.spin = d.spin || defaults.spin;
    }

    localStorage.setItem('earnx_state', JSON.stringify(window.state));
    window.nav('home');
    startTimers();
    loadWithdrawals();
};

onAuthStateChanged(auth, u => { if (u) window.handleSuccessfulLogin(u); });

window.loginWithGoogle = async () => {
    if (loginProcessing) return;
    loginProcessing = true;
    try {
        const res = await signInWithPopup(auth, new GoogleAuthProvider());
        await window.handleSuccessfulLogin(res.user);
    } catch (e) { loginProcessing = false; }
};

window.loginWithEmail = async () => {
    const e = document.getElementById('email-input').value.trim();
    const p = document.getElementById('password-input').value.trim();
    if (!e || p.length < 6) return window.showToast("Invalid Input");
    try {
        await signInWithEmailAndPassword(auth, e, p);
    } catch (err) {
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
            const res = await createUserWithEmailAndPassword(auth, e, p);
            await sendEmailVerification(res.user);
            window.showToast("Verify your email!");
        } else window.showToast("Login Failed");
    }
};

window.saveProfileDetails = async () => {
    const n = document.getElementById('profile-name-input').value.trim();
    const ph = document.getElementById('profile-phone-input').value.trim();
    const btn = document.getElementById('btn-save-profile');
    if (!n) return window.showToast("Name required");
    try {
        await updateDoc(doc(db, "earnx_users", window.currentUser.uid), { profile: { name: n, phone: ph } });
        window.state.user.profile = { name: n, phone: ph };
        btn.innerText = "Details Saved ✓";
        btn.disabled = true;
        window.showToast("Profile Updated!");
        setTimeout(() => { btn.innerText = "Save Details"; btn.disabled = false; }, 3000);
    } catch (e) { window.showToast("Error saving"); }
};

window.logout = () => signOut(auth).then(() => { localStorage.clear(); location.reload(); });

/* === ADS & TASKS === */

async function showAd(callback) {
    if (isTimeLocked) return window.showToast("Syncing...");
    if (window.getTrueTime() - lastAdTime < 60000) {
        window.showToast("Wait 1 min for next ad");
        if (callback) callback();
        return;
    }

    if (window.Capacitor && window.Capacitor.Plugins.AdMob) {
        try {
            const { AdMob } = window.Capacitor.Plugins;
            await AdMob.prepareRewardVideoAd({ adId: "ca-app-pub-6519206650027176/8005768127" });
            let l = AdMob.addListener('onRewardedVideoAdRewarded', () => {
                lastAdTime = window.getTrueTime();
                if (callback) callback();
                l.remove();
            });
            await AdMob.showRewardVideoAd();
        } catch (e) { if (callback) callback(); }
    } else {
        const m = document.getElementById('ad-modal');
        m.style.display = 'flex';
        let sec = 3;
        const itv = setInterval(() => {
            sec--;
            document.getElementById('ad-timer').innerText = sec;
            if (sec <= 0) {
                clearInterval(itv);
                m.style.display = 'none';
                lastAdTime = window.getTrueTime();
                if (callback) callback();
            }
        }, 1000);
    }
}

window.dailyCheckIn = () => {
    const last = window.state.tasks.checkInTime || 0;
    if (window.getTrueTime() - last < 86400000) return window.showToast("Claimed!");
    window.state.tasks.checkInTime = window.getTrueTime();
    rewardCoins(50);
};

window.doWatchTask = () => {
    const now = window.getTrueTime();
    let h = window.state.tasks.watchHistory || [];
    h = h.filter(t => now - t < 3 * 3600000);
    if (h.length >= 3) return window.showToast("Limit reached!");
    if (now - window.state.tasks.lastWatch < COOLDOWN_WATCH) return window.showToast("Wait for timer");
    showAd(() => {
        window.state.tasks.lastWatch = now;
        h.push(now);
        window.state.tasks.watchHistory = h;
        rewardCoins(100);
    });
};

window.doStayTask = () => {
    if (window.getTrueTime() - window.state.tasks.lastStay < COOLDOWN_STAY) return window.showToast("Wait 30m");
    showAd(() => {
        const m = document.getElementById('stay-modal');
        const c = document.getElementById('stay-countdown');
        m.style.display = 'flex';
        let left = 15;
        const itv = setInterval(() => {
            left--; c.innerText = left;
            if (left <= 0) {
                clearInterval(itv);
                m.style.display = 'none';
                window.state.tasks.lastStay = window.getTrueTime();
                rewardCoins(200);
            }
        }, 1000);
    });
};

window.doTapTask = () => {
    if (window.state.tasks.tapCount >= 20) return;
    if (window.getTrueTime() - window.state.tasks.lastTap < COOLDOWN_TAP) return window.showToast("Wait 1h");
    window.state.tasks.tapCount++;
    if (window.state.tasks.tapCount >= 20) {
        window.state.tasks.tapCount = 0;
        window.state.tasks.lastTap = window.getTrueTime();
        rewardCoins(150);
    }
    updateUI();
};

window.spinWheel = () => {
    const btn = document.getElementById('btn-spin');
    if (window.state.spin.spinsLeft <= 0) return window.showToast("No spins!");
    btn.disabled = true;
    window.state.spin.spinsLeft--;
    window.state.spin.totalSpins++;
    if (window.state.spin.spinsLeft === 4) window.state.spin.lastRefill = window.getTrueTime();

    const prizes = [100, 75, 50, 20, 10, 5];
    const r = Math.floor(Math.random() * 6);
    const deg = (360 * 5) + (360 - (r * 60));
    document.getElementById('wheel-inner').style.transform = `rotate(${deg}deg)`;

    setTimeout(() => {
        rewardCoins(prizes[r]);
        if (window.state.spin.totalSpins % 3 === 0) {
            showAd(() => { btn.disabled = false; });
        } else {
            btn.disabled = false;
        }
    }, 4500);
};

/* === SHARE & WITHDRAW === */

window.copyReferral = () => {
    const code = window.state.user.refCode;
    const el = document.createElement('textarea');
    el.value = code;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    window.showToast("Code Copied!");
};

window.shareReferral = async () => {
    const text = `Join EarnX & earn rewards! My code: ${window.state.user.refCode}`;
    try {
        if (navigator.share) {
            await navigator.share({ title: 'EarnX', text: text, url: 'https://dukaan-platform.firebaseapp.com' });
        } else {
            window.copyReferral();
            window.showToast("Invite Link Copied!");
        }
    } catch (e) { window.copyReferral(); }
};

window.submitWithdraw = async () => {
    await auth.currentUser.reload();
    if (!auth.currentUser.emailVerified) return window.showToast("Verify email first!");
    const upi = document.getElementById('upi-input').value.trim();
    const coins = Math.floor(window.state.user.coins / 10000) * 10000;
    if (coins < 10000) return window.showToast("Min 10,000 coins");
    if (!upi.includes('@')) return window.showToast("Invalid UPI");

    try {
        const userRef = doc(db, "
