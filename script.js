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
        // Fallback to local time if API fails so tasks remain accessible
        serverTimeOffset = Date.now() - performance.now();
        isTimeLocked = false;
        checkVersion();
    }
}

window.getTrueTime = () => performance.now() + serverTimeOffset;

async function checkVersion() {
    try {
        const snap = await getDoc(doc(db, "earnx_config", "app_settings"));
        if (snap.exists() && snap.data().latest_version !== CURRENT_VERSION) {
            window.updateUrl = snap.data().update_url || "https://play.google.com";
            document.getElementById('update-screen').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
        }
    } catch (e) {
        console.log("Version check skipped due to network.");
    }
}

window.showToast = (m) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = m;
    t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3000);
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

onAuthStateChanged(auth, u => { 
    if (u && !loginProcessing) {
        window.handleSuccessfulLogin(u); 
    }
});

window.loginWithGoogle = async () => {
    if (loginProcessing) return;
    loginProcessing = true;
    try {
        const res = await signInWithPopup(auth, new GoogleAuthProvider());
        await window.handleSuccessfulLogin(res.user);
    } catch (e) { 
        loginProcessing = false; 
    }
};

window.loginWithEmail = async () => {
    const e = document.getElementById('email-input').value.trim();
    const p = document.getElementById('password-input').value.trim();
    if (!e || p.length < 6) return window.showToast("Invalid Input (Pass min 6 chars)");
    
    loginProcessing = true;
    try {
        await signInWithEmailAndPassword(auth, e, p);
    } catch (err) {
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
            try {
                const res = await createUserWithEmailAndPassword(auth, e, p);
                await sendEmailVerification(res.user);
                window.showToast("Verify your email!");
                await window.handleSuccessfulLogin(res.user);
            } catch (regErr) {
                window.showToast("Registration failed");
            }
        } else {
            window.showToast("Login Failed");
        }
    }
    loginProcessing = false;
};

window.saveProfileDetails = async () => {
    const n = document.getElementById('profile-name-input').value.trim();
    const ph = document.getElementById('profile-phone-input').value.trim();
    const btn = document.getElementById('btn-save-profile');
    if (!n) return window.showToast("Name required");
    try {
        await updateDoc(doc(db, "earnx_users", window.currentUser.uid), { 
            profile: { name: n, phone: ph } 
        });
        window.state.user.profile = { name: n, phone: ph };
        
        // Visual feedback
        btn.innerText = "Details Saved ✓";
        btn.disabled = true;
        window.showToast("Profile Updated!");
        setTimeout(() => { 
            btn.innerText = "Save Details"; 
            btn.disabled = false; 
        }, 3000);
    } catch (e) { 
        window.showToast("Error saving"); 
    }
};

window.logout = () => {
    signOut(auth).then(() => { 
        localStorage.clear(); 
        location.reload(); 
    });
};

/* === ADS & TASKS === */

async function showAd(callback) {
    if (isTimeLocked) return window.showToast("Syncing...");
    
    // 1 minute ad cooldown
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
        } catch (e) { 
            if (callback) callback(); 
        }
    } else {
        // Web Fallback
        const m = document.getElementById('ad-modal');
        m.style.display = 'flex';
        let sec = 3;
        document.getElementById('ad-timer').innerText = sec;
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
    h = h.filter(t => now - t < 10800000); // 3 hour slot
    
    if (h.length >= 3) return window.showToast("Limit reached for 3h slot!");
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
        c.innerText = left;
        const itv = setInterval(() => {
            left--; 
            c.innerText = left;
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
    
    const wheel = document.getElementById('wheel-inner');
    wheel.style.transform = `rotate(${deg}deg)`;

    setTimeout(() => {
        rewardCoins(prizes[r]);
        // Trigger ad exactly after every 3 spins
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
    const code = window.state.user ? window.state.user.refCode : "";
    const text = `Join EarnX & earn real rewards. Use my code: ${code}\nLink: https://dukaan-platform.firebaseapp.com`;
    try {
        if (navigator.share) {
            await navigator.share({ title: 'EarnX Rewards', text: text, url: 'https://dukaan-platform.firebaseapp.com' });
        } else {
            window.copyReferral();
            window.showToast("Invite Link Copied!");
        }
    } catch (e) { 
        window.copyReferral(); 
    }
};

window.applyReferralFirebase = async () => {
    const code = document.getElementById('ref-input').value.trim().toUpperCase();
    if (!code) return window.showToast("Enter code");
    if (window.state.user.referredBy) return window.showToast("Code already used");
    
    try {
        const qSnap = await getDocs(query(collection(db, "earnx_users"), where("refCode", "==", code)));
        if (qSnap.empty) return window.showToast("Invalid Code");
        
        window.state.user.coins += 100;
        window.state.user.referredBy = qSnap.docs[0].id;
        rewardCoins(0); // Save state
        window.showToast("+100 Referral Bonus!");
    } catch (e) { 
        window.showToast("Error applying code"); 
    }
};

window.submitWithdraw = async () => {
    await auth.currentUser.reload();
    if (!auth.currentUser.emailVerified) return window.showToast("Verify email in Profile first!");
    
    const upi = document.getElementById('upi-input').value.trim();
    const coins = Math.floor(window.state.user.coins / 10000) * 10000;
    if (coins < 10000) return window.showToast("Min 10,000 coins (₹100)");
    if (!upi.includes('@')) return window.showToast("Invalid UPI");

    try {
        const userRef = doc(db, "earnx_users", window.state.user.id);
        await updateDoc(userRef, { coins: window.state.user.coins - coins });
        await addDoc(collection(db, "earnx_withdrawals"), { 
            userId: window.state.user.id, 
            coins: coins, 
            upiId: upi, 
            status: "Pending", 
            createdAt: serverTimestamp() 
        });
        window.state.user.coins -= coins;
        rewardCoins(0); 
        loadWithdrawals();
        window.showToast("Withdrawal Requested!");
        document.getElementById('upi-input').value = "";
    } catch (e) { 
        window.showToast("Transaction Error"); 
    }
};

window.loadWithdrawals = async () => {
    if(!window.currentUser) return;
    try {
        const q = query(collection(db, "earnx_withdrawals"), where("userId", "==", window.currentUser.uid));
        const snap = await getDocs(q);
        window.state.withdrawals = [];
        snap.forEach(doc => {
            const d = doc.data();
            window.state.withdrawals.push({
                amount: (d.coins / 100),
                upi: d.upiId,
                date: d.createdAt ? (d.createdAt.seconds * 1000) : Date.now(),
                status: d.status
            });
        });
        updateUI();
    } catch (e) {}
};

/* === HELPERS & UI === */

window.nav = (s) => {
    document.querySelectorAll('.screen').forEach(e => e.classList.remove('active'));
    const target = document.getElementById('screen-' + s);
    if (target) target.classList.add('active');
    document.getElementById('bottom-nav').style.display = (s === 'login') ? 'none' : 'flex';
    
    // Update active nav icon
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    const activeItem = document.querySelector(`.nav-item[onclick*="'${s}'"]`);
    if(activeItem) activeItem.classList.add('active');
    
    updateUI();
};

function rewardCoins(a) {
    window.state.user.coins += a;
    localStorage.setItem('earnx_state', JSON.stringify(window.state));
    updateUI();
    const ref = doc(db, "earnx_users", window.state.user.id);
    updateDoc(ref, { 
        coins: window.state.user.coins, 
        tasks: window.state.tasks, 
        spin: window.state.spin 
    });
}

function updateUI() {
    if (!window.state.user) return;
    document.querySelectorAll('.global-coin-display').forEach(e => e.innerText = window.state.user.coins.toLocaleString());
    document.getElementById('rupee-display').innerText = (window.state.user.coins / 100).toFixed(2);
    document.getElementById('profile-email').innerText = window.state.user.email || "User";
    document.getElementById('profile-uid').innerText = window.state.user.id;
    document.getElementById('spin-count-display').innerText = window.state.spin.spinsLeft;
    document.getElementById('tap-count').innerText = window.state.tasks.tapCount;
    document.getElementById('my-ref-code').innerText = window.state.user.refCode || "------";
    
    // Daily Checkin Button Status
    const checkinBtn = document.getElementById('btn-checkin');
    if(checkinBtn) {
        if(window.getTrueTime() - (window.state.tasks.checkInTime || 0) < 86400000) {
            checkinBtn.disabled = true;
            checkinBtn.innerText = "Claimed";
        } else {
            checkinBtn.disabled = false;
            checkinBtn.innerText = "Claim 50";
        }
    }
}

function startTimers() {
    setInterval(() => {
        if (isTimeLocked) return;
        const now = window.getTrueTime();
        const upd = (id, last, cd) => {
            const d = document.getElementById(id + '-timer-display');
            const b = document.getElementById('btn-' + id);
            if (!d || !b) return;
            const diff = cd - (now - last);
            if (diff > 0) {
                b.disabled = true;
                const m = Math.floor(diff / 60000);
                const s = Math.floor((diff % 60000) / 1000);
                d.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
            } else {
                if(id === 'tap' && window.state.tasks.tapCount >= 20) {
                   b.disabled = true; d.innerText = "Done";
                } else {
                   b.disabled = false; d.innerText = "Ready";
                }
            }
        };
        upd('watch', window.state.tasks.lastWatch, COOLDOWN_WATCH);
        upd('stay', window.state.tasks.lastStay, COOLDOWN_STAY);
        
        // Spin refill timer
        const spinDisp = document.getElementById('spin-refill-timer');
        if(window.state.spin.spinsLeft < 5 && window.state.spin.lastRefill > 0) {
            const passed = now - window.state.spin.lastRefill;
            if(passed >= SPIN_REFILL_MS) { 
                window.state.spin.spinsLeft = 5; window.state.spin.lastRefill = 0;
                localStorage.setItem('earnx_state', JSON.stringify(window.state));
            } else {
                const rem = SPIN_REFILL_MS - passed;
                const m = Math.floor(rem / 60000);
                const s = Math.floor((rem % 60000) / 1000);
                if(spinDisp) spinDisp.innerText = `Refill in: ${m}:${s < 10 ? '0' : ''}${s}`;
            }
        } else if(spinDisp) {
            spinDisp.innerText = "";
        }
    }, 1000);
}

/* === SPLASH SCREEN HIDE LOGIC === */
document.addEventListener("DOMContentLoaded", () => {
    syncTime();
    // 2.5 seconds delay to show logo and sync background
    setTimeout(() => {
        const splash = document.getElementById('custom-splash');
        if (splash) {
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.style.display = 'none';
            }, 600);
        }
    }, 2500);
});
