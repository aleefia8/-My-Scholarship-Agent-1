import React, { useState, useEffect, useMemo } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- TYPES & ENUMS ---
enum AppSection {
  HOME = 'home',
  PROFILE = 'profile',
  MATCHES = 'matches',
  TRACKER = 'tracker',
  CHAT = 'chat'
}

interface StudentProfile {
  name: string;
  gpa: string;
  major: string;
  interests: string;
  gradeLevel: string;
  achievements: string;
  extracurriculars: string;
  personalStatementFragment: string;
}

interface ScholarshipMatch {
  id: string;
  name: string;
  amount: string;
  deadline: string;
  matchScore: number;
  reason: string;
  requirements: string[];
}

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyDIAN6NLcPHI2KuTw_8GORTYZ-4UlwWljg",
  authDomain: "my-scholarship-agent.firebaseapp.com",
  projectId: "my-scholarship-agent",
  storageBucket: "my-scholarship-agent.firebasestorage.app",
  messagingSenderId: "428176464659",
  appId: "1:428176464659:web:07af3bd53b73309d2458e6"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// --- UI HELPERS ---
const SidebarItem = ({ icon, label, active, onClick }: { icon: string, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`flex items-center space-x-3 w-full p-4 rounded-2xl transition-all duration-300 ${
      active ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-200' : 'text-slate-500 hover:bg-slate-100'
    }`}
  >
    <i className={`fas ${icon} w-5`}></i>
    <span className="font-bold text-sm">{label}</span>
  </button>
);

const App: React.FC = () => {
  const [activeSection, setActiveSection] = useState<AppSection>(AppSection.HOME);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [user, setUser] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<{ code: string, message: string, domain: string } | null>(null);
  
  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  const [profile, setProfile] = useState<StudentProfile>({ 
    name: '', gpa: '', major: '', interests: '', gradeLevel: 'High School Senior', 
    achievements: '', extracurriculars: '', personalStatementFragment: ''
  });
  const [matches, setMatches] = useState<ScholarshipMatch[]>([]);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', parts: { text: string }[] }[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecking(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user?.uid) {
      const unsubscribe = onSnapshot(doc(db, "users", user.uid), (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.profile) setProfile(data.profile);
          if (data.matches) setMatches(data.matches);
          if (data.chatHistory) setChatHistory(data.chatHistory);
        }
      });
      return () => unsubscribe();
    }
  }, [user]);

  const syncToCloud = async (updates: any) => {
    if (user?.uid) {
      await setDoc(doc(db, "users", user.uid), updates, { merge: true });
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setAuthError({
        code: err.code || 'unknown',
        message: err.message || "An error occurred during Google sign-in.",
        domain: window.location.hostname
      });
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!email || !password) return;

    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      let customMsg = "Authentication failed.";
      if (err.code === 'auth/email-already-in-use') customMsg = "This email is already registered.";
      if (err.code === 'auth/wrong-password') customMsg = "Incorrect password.";
      if (err.code === 'auth/user-not-found') customMsg = "No account found with this email.";
      if (err.code === 'auth/weak-password') customMsg = "Password should be at least 6 characters.";
      
      setAuthError({
        code: err.code || 'unknown',
        message: customMsg,
        domain: window.location.hostname
      });
    }
  };

  const handleDiscovery = async () => {
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const prompt = `Act as a scholarship expert. Based on this student profile: ${JSON.stringify(profile)}, use Google Search to find 5 high-potential scholarships they should apply for. Return your answer as a JSON array of objects.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                amount: { type: Type.STRING },
                deadline: { type: Type.STRING },
                matchScore: { type: Type.NUMBER },
                reason: { type: Type.STRING },
                requirements: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["id", "name", "amount", "deadline", "matchScore", "reason", "requirements"]
            }
          }
        }
      });

      const results = JSON.parse(response.text || "[]");
      await syncToCloud({ matches: results });
      setActiveSection(AppSection.MATCHES);
    } catch (err) {
      console.error("Discovery Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async () => {
    if (!input.trim()) return;
    const userMsg = input;
    setInput('');
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [...chatHistory, { role: 'user', parts: [{ text: userMsg }] }],
        config: { systemInstruction: "You are a scholarship expert." }
      });
      const aiText = response.text || "No response.";
      const newHistory = [...chatHistory, { role: 'user' as const, parts: [{ text: userMsg }] }, { role: 'model' as const, parts: [{ text: aiText }] }];
      await syncToCloud({ chatHistory: newHistory });
    } catch (err) {
      console.error("Chat Error:", err);
    } finally {
      setLoading(false);
    }
  };

  if (authChecking) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest">Portal Waking Up...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    const isDomainError = authError?.code === 'auth/unauthorized-domain' || authError?.code === 'auth/unauthorized-continue-uri';
    const currentUrl = window.location.hostname;

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 space-y-8">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white text-4xl mx-auto shadow-xl">
              <i className="fas fa-graduation-cap"></i>
            </div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">ScholarshipAI</h1>
            <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">{isSignUp ? 'Create Scholar Account' : 'Sign Into Portal'}</p>
          </div>

          {authError && !isDomainError && (
            <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100 text-rose-600 text-xs font-black animate-fadeIn">
              <i className="fas fa-exclamation-circle mr-2"></i>
              {authError.message}
            </div>
          )}

          {isDomainError && (
            <div className="bg-amber-50 p-6 rounded-[2rem] border border-amber-100 text-left space-y-4 animate-fadeIn">
              <p className="text-amber-800 text-[10px] font-black uppercase tracking-widest flex items-center">
                <i className="fas fa-shield-halved mr-2"></i> Security Alert
              </p>
              <p className="text-slate-600 text-[11px] leading-relaxed font-bold">Add this domain to Firebase Authorized Domains:</p>
              <div className="flex bg-white p-3 rounded-xl border border-amber-200">
                <code className="text-[10px] font-mono font-bold flex-1 truncate">{currentUrl}</code>
                <button onClick={() => { navigator.clipboard.writeText(currentUrl); alert("Copied!"); }} className="ml-2 text-[10px] font-black text-indigo-600">COPY</button>
              </div>
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Email Address</label>
              <input 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                placeholder="you@scholar.com"
                className="w-full p-5 bg-slate-50 border border-slate-100 rounded-[1.5rem] outline-none focus:ring-4 focus:ring-indigo-50 transition-all font-bold text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Password</label>
              <input 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                placeholder="••••••••"
                className="w-full p-5 bg-slate-50 border border-slate-100 rounded-[1.5rem] outline-none focus:ring-4 focus:ring-indigo-50 transition-all font-bold text-sm"
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-indigo-600 text-white font-black py-5 rounded-[1.5rem] shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
            >
              {isSignUp ? 'Start Your Journey' : 'Access Portal'}
            </button>
          </form>

          <div className="relative flex py-4 items-center">
            <div className="flex-grow border-t border-slate-100"></div>
            <span className="flex-shrink mx-4 text-slate-300 font-bold text-[10px] uppercase tracking-widest">or</span>
            <div className="flex-grow border-t border-slate-100"></div>
          </div>

          <button 
            onClick={handleGoogleLogin}
            className="w-full bg-white text-slate-900 border border-slate-100 font-black py-5 rounded-[1.5rem] flex items-center justify-center space-x-3 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
          >
            <i className="fab fa-google text-indigo-600"></i>
            <span>Continue with Google</span>
          </button>

          <p className="text-center text-xs font-bold text-slate-500">
            {isSignUp ? 'Already have an account?' : 'Need an account?'}
            <button 
              onClick={() => setIsSignUp(!isSignUp)}
              className="ml-2 text-indigo-600 font-black hover:underline"
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <aside className="w-72 bg-white border-r border-slate-200 p-8 hidden lg:flex flex-col fixed h-full">
        <div className="flex items-center space-x-3 mb-12">
          <div className="bg-indigo-600 w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg">
            <i className="fas fa-graduation-cap"></i>
          </div>
          <h1 className="text-xl font-black italic tracking-tighter text-slate-900">AGENT</h1>
        </div>
        <nav className="space-y-2 flex-1">
          <SidebarItem icon="fa-house" label="Dashboard" active={activeSection === AppSection.HOME} onClick={() => setActiveSection(AppSection.HOME)} />
          <SidebarItem icon="fa-id-card" label="My Profile" active={activeSection === AppSection.PROFILE} onClick={() => setActiveSection(AppSection.PROFILE)} />
          <SidebarItem icon="fa-bolt" label="Find Matches" active={activeSection === AppSection.MATCHES} onClick={() => setActiveSection(AppSection.MATCHES)} />
          <SidebarItem icon="fa-comment-dots" label="AI Advisor" active={activeSection === AppSection.CHAT} onClick={() => setActiveSection(AppSection.CHAT)} />
        </nav>
        <button onClick={() => signOut(auth)} className="mt-auto p-4 text-slate-400 hover:text-rose-500 text-sm font-black flex items-center space-x-2 transition-colors">
          <i className="fas fa-power-off"></i>
          <span>Logout Session</span>
        </button>
      </aside>

      <main className="flex-1 lg:ml-72 p-6 md:p-12">
        <div className="max-w-4xl mx-auto space-y-12">
          {activeSection === AppSection.HOME && (
            <div className="space-y-10 animate-fadeIn">
              <h2 className="text-4xl font-black text-slate-900">Welcome, {user.displayName?.split(' ')[0] || 'Scholar'}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="p-10 bg-indigo-600 rounded-[3rem] text-white flex flex-col justify-between shadow-2xl shadow-indigo-100 min-h-[300px]">
                    <h3 className="text-3xl font-black leading-tight">Find funding for your next semester.</h3>
                    <button onClick={handleDiscovery} className="mt-8 bg-white text-indigo-900 px-8 py-5 rounded-2xl font-black text-lg hover:scale-105 transition-all shadow-xl active:scale-95">
                        Scan Now
                    </button>
                 </div>
                 <div className="p-10 bg-white rounded-[3rem] border border-slate-100 shadow-sm flex flex-col justify-center space-y-6">
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Setup Stats</p>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm font-black text-slate-900">
                            <span>Profile Score</span>
                            <span>{profile.name ? '85%' : '15%'}</span>
                        </div>
                        <div className="h-4 bg-slate-50 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: profile.name ? '85%' : '15%' }}></div>
                        </div>
                    </div>
                    <button onClick={() => setActiveSection(AppSection.PROFILE)} className="text-indigo-600 font-black text-sm hover:underline">Complete Scholar ID →</button>
                 </div>
              </div>
            </div>
          )}

          {activeSection === AppSection.PROFILE && (
            <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100 space-y-8 animate-fadeIn">
              <h3 className="text-2xl font-black text-slate-900">Scholar ID</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Full Name</label>
                  <input type="text" placeholder="Alex Student" value={profile.name} onChange={e => setProfile({...profile, name: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-50 transition-all font-bold" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Current GPA</label>
                  <input type="text" placeholder="3.8" value={profile.gpa} onChange={e => setProfile({...profile, gpa: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-50 transition-all font-bold" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Accomplishments</label>
                <textarea placeholder="Sports, volunteering, awards..." value={profile.achievements} onChange={e => setProfile({...profile, achievements: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl h-32 outline-none focus:ring-4 focus:ring-indigo-50 transition-all font-medium" />
              </div>
              <button onClick={() => syncToCloud({ profile })} className="w-full py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black hover:bg-indigo-700 transition-all shadow-lg active:scale-95">
                Save Changes
              </button>
            </div>
          )}

          {activeSection === AppSection.MATCHES && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fadeIn">
              {matches.length === 0 ? (
                <div className="col-span-2 text-center py-24 bg-white rounded-[3rem] border border-dashed border-slate-200">
                  <p className="text-slate-400 font-bold italic">No scholarships found. Hit "Scan Now" on the Dashboard.</p>
                </div>
              ) : matches.map(m => (
                <div key={m.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-2xl transition-all group">
                  <div className="flex justify-between items-start mb-6">
                    <p className="text-3xl font-black text-indigo-600">{m.amount}</p>
                    <span className="text-indigo-600 text-[10px] font-black bg-indigo-50 px-3 py-1 rounded-lg uppercase tracking-widest">{m.matchScore}% Match</span>
                  </div>
                  <h4 className="font-bold text-xl mb-2 text-slate-900">{m.name}</h4>
                  <p className="text-xs text-slate-500 mb-6 leading-relaxed font-medium line-clamp-3">{m.reason}</p>
                  <button onClick={() => setActiveSection(AppSection.CHAT)} className="w-full py-4 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest group-hover:bg-indigo-600 transition-all">
                    Consult AI Agent
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeSection === AppSection.CHAT && (
            <div className="flex flex-col h-[70vh] bg-white rounded-[3.5rem] border border-slate-100 shadow-2xl overflow-hidden animate-fadeIn">
              <div className="flex-1 overflow-y-auto p-10 space-y-6 bg-slate-50/10">
                {chatHistory.length === 0 && (
                  <div className="text-center py-20 space-y-4">
                    <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-[1.5rem] flex items-center justify-center mx-auto text-2xl">
                      <i className="fas fa-robot"></i>
                    </div>
                    <p className="text-slate-400 font-bold italic text-sm">Ask me for essay prompts or local scholarship lists.</p>
                  </div>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-6 rounded-[2.2rem] shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 rounded-tl-none'}`}>
                      <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{msg.parts[0].text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-8 border-t border-slate-100 flex items-center space-x-4 bg-white">
                <input value={input} onChange={e => setInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleChat()} placeholder="Ask anything about aid..." className="flex-1 p-5 bg-slate-50 rounded-2xl border border-slate-100 outline-none font-bold text-sm" />
                <button onClick={handleChat} disabled={loading} className="w-16 h-16 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg active:scale-90 transition-all">
                  <i className="fas fa-paper-plane"></i>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Global Loader */}
      {loading && (
        <div className="fixed inset-0 bg-slate-900/5 backdrop-blur-sm z-[500] flex items-center justify-center animate-fadeIn">
          <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center space-y-6 border border-slate-100">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="font-black text-[10px] uppercase tracking-[0.3em] text-slate-900">AI Thinking...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;