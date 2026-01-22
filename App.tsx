import React, { useState, useEffect, useMemo } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- CONSOLIDATED TYPES ---
enum AppSection {
  HOME = 'home',
  PROFILE = 'profile',
  MATCHES = 'matches',
  TRACKER = 'tracker',
  CHAT = 'chat'
}

interface StudentProfile {
  name: string; gpa: string; major: string; interests: string; gradeLevel: string;
  achievements: string; extracurriculars: string; personalStatementFragment: string;
  trustAutoApply: boolean;
}

interface ScholarshipMatch {
  id: string; name: string; amount: string; deadline: string; matchScore: number;
  reason: string; canAutoApply: boolean; requirements: string[];
}

interface ApplicationRecord {
  id: string; scholarshipId: string; name: string;
  status: 'Drafting' | 'Review Required' | 'Submitted' | 'Decision Received';
  generatedEssay?: string; aiNotes?: string;
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

// Initialize Firebase safely
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// --- UI COMPONENTS ---
const SidebarItem = ({ icon, label, active, onClick }: { icon: string, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`flex items-center space-x-3 w-full p-4 rounded-2xl transition-all duration-300 ${
      active ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-100'
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
  
  const [profile, setProfile] = useState<StudentProfile>({ 
    name: '', gpa: '', major: '', interests: '', gradeLevel: 'High School Senior', 
    achievements: '', extracurriculars: '', personalStatementFragment: '',
    trustAutoApply: false
  });
  const [matches, setMatches] = useState<ScholarshipMatch[]>([]);
  const [apps, setApps] = useState<ApplicationRecord[]>([]);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model', parts: { text: string }[] }[]>([]);

  // Watch Authentication State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecking(false);
    });
    return () => unsubscribe();
  }, []);

  // Sync Data from Firestore
  useEffect(() => {
    if (user?.uid) {
      const unsubscribe = onSnapshot(doc(db, "users", user.uid), (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.profile) setProfile(data.profile);
          if (data.apps) setApps(data.apps);
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

  const handleLogin = async () => {
    setAuthError(null);
    const domain = window.location.hostname || "localhost";
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Firebase Login Error:", err);
      setAuthError({
        code: err.code || 'unknown',
        message: err.message || "Login failed.",
        domain: domain
      });
    }
  };

  const handleDiscovery = async () => {
    if (!process.env.API_KEY) {
      alert("API Key is missing. Please ensure it is set in Netlify Environment Variables.");
      return;
    }
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Based on this student profile: ${JSON.stringify(profile)}, find 5 real scholarships. Return as a JSON array of objects.`;
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
                canAutoApply: { type: Type.BOOLEAN },
                requirements: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["id", "name", "amount", "deadline", "matchScore", "reason", "canAutoApply", "requirements"]
            }
          }
        }
      });
      const results = JSON.parse(response.text || "[]");
      await syncToCloud({ matches: results });
      setActiveSection(AppSection.MATCHES);
    } catch (err) {
      console.error(err);
      alert("AI Scan failed. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async () => {
    if (!input.trim() || !process.env.API_KEY) return;
    const msg = input;
    setInput('');
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [...chatHistory, { role: 'user', parts: [{ text: msg }] }],
        config: { systemInstruction: "You are a world-class scholarship advisor." }
      });
      const aiText = response.text || "";
      const newHistory = [...chatHistory, { role: 'user' as const, parts: [{ text: msg }] }, { role: 'model' as const, parts: [{ text: aiText }] }];
      await syncToCloud({ chatHistory: newHistory });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const profileStrength = useMemo(() => {
    let score = 0;
    if (profile.name) score += 20;
    if (profile.gpa) score += 20;
    if (profile.achievements.length > 10) score += 30;
    if (profile.personalStatementFragment.length > 20) score += 30;
    return score;
  }, [profile]);

  if (authChecking) {
    return <div className="flex h-screen items-center justify-center text-slate-400 font-bold uppercase tracking-widest animate-pulse">Initializing Portal...</div>;
  }

  if (!user) {
    const isDomainError = authError?.code === 'auth/unauthorized-domain' || authError?.code === 'auth/unauthorized-continue-uri';
    const currentUrl = authError?.domain || window.location.hostname || "localhost";

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-10 rounded-[3rem] shadow-2xl border border-slate-100 space-y-8 animate-fadeIn">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white text-3xl mx-auto shadow-xl shadow-indigo-100">
              <i className="fas fa-graduation-cap"></i>
            </div>
            <h1 className="text-3xl font-black text-slate-900">ScholarshipAI</h1>
            <p className="text-slate-500 text-sm">Sign in to find your perfect match.</p>
          </div>

          {isDomainError ? (
            <div className="bg-rose-50 p-6 rounded-[2rem] border border-rose-100 space-y-4">
              <div className="flex items-center space-x-2 text-rose-600 font-black text-[10px] uppercase tracking-widest">
                <i className="fas fa-shield-halved"></i>
                <span>Action Required</span>
              </div>
              <p className="text-rose-900 text-xs font-bold leading-relaxed">
                Firebase is blocking the login because this website address isn't on your whitelist yet.
              </p>
              <div className="flex items-center bg-white p-3 rounded-xl border border-rose-200">
                <code className="text-xs font-mono text-slate-900 flex-1 truncate font-bold">{currentUrl}</code>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(currentUrl);
                    alert("Copied! Now go to Firebase console.");
                  }}
                  className="ml-2 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-[10px] font-black hover:bg-rose-700 transition-all shadow-md active:scale-95"
                >COPY</button>
              </div>
              <div className="text-[10px] text-rose-700 space-y-2">
                <p>1. Open your <a href="https://console.firebase.google.com/" target="_blank" className="font-bold underline text-rose-600">Firebase Console</a>.</p>
                <p>2. Go to <b>Authentication</b> &rarr; <b>Settings</b> &rarr; <b>Authorized domains</b>.</p>
                <p>3. Click <b>Add domain</b> and paste the text above.</p>
              </div>
            </div>
          ) : authError && (
            <div className="bg-rose-50 p-4 rounded-xl text-rose-600 text-[10px] font-bold">
              {authError.message}
            </div>
          )}

          <button 
            onClick={handleLogin}
            className="w-full bg-slate-900 text-white font-black py-5 rounded-2xl flex items-center justify-center space-x-3 hover:bg-indigo-600 transition-all shadow-xl active:scale-95"
          >
            <i className="fab fa-google"></i>
            <span>{isDomainError ? 'Retry Sign In' : 'Continue with Google'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 p-8 hidden lg:flex flex-col fixed h-full">
        <div className="flex items-center space-x-3 mb-12">
          <div className="bg-indigo-600 w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
            <i className="fas fa-graduation-cap"></i>
          </div>
          <h1 className="text-xl font-black italic tracking-tighter">HUB</h1>
        </div>
        <nav className="space-y-2 flex-1">
          <SidebarItem icon="fa-house" label="Dashboard" active={activeSection === AppSection.HOME} onClick={() => setActiveSection(AppSection.HOME)} />
          <SidebarItem icon="fa-id-card" label="My Profile" active={activeSection === AppSection.PROFILE} onClick={() => setActiveSection(AppSection.PROFILE)} />
          <SidebarItem icon="fa-bolt" label="AI Matcher" active={activeSection === AppSection.MATCHES} onClick={() => setActiveSection(AppSection.MATCHES)} />
          <SidebarItem icon="fa-folder-open" label="Drafts" active={activeSection === AppSection.TRACKER} onClick={() => setActiveSection(AppSection.TRACKER)} />
          <SidebarItem icon="fa-comment-dots" label="AI Advisor" active={activeSection === AppSection.CHAT} onClick={() => setActiveSection(AppSection.CHAT)} />
        </nav>
        <button onClick={() => signOut(auth)} className="mt-auto p-4 text-slate-400 hover:text-rose-500 text-sm font-bold flex items-center space-x-2 transition-colors">
          <i className="fas fa-power-off"></i>
          <span>Logout</span>
        </button>
      </aside>

      {/* Content */}
      <main className="flex-1 lg:ml-72 p-6 md:p-12">
        <div className="max-w-4xl mx-auto space-y-12">
          {activeSection === AppSection.HOME && (
            <div className="space-y-10 animate-fadeIn">
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">Welcome, {user.displayName?.split(' ')[0]} 👋</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                  <p className="text-slate-400 text-[10px] font-black uppercase mb-1">Found Matches</p>
                  <p className="text-4xl font-black">{matches.length}</p>
                </div>
                <div className="bg-indigo-600 p-8 rounded-3xl shadow-xl text-white">
                  <p className="text-indigo-200 text-[10px] font-black uppercase mb-1">Active Drafts</p>
                  <p className="text-4xl font-black">{apps.length}</p>
                </div>
                <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                  <p className="text-slate-400 text-[10px] font-black uppercase mb-1">Profile Strength</p>
                  <p className="text-4xl font-black">{profileStrength}%</p>
                </div>
              </div>
              <div className="p-12 bg-indigo-600 rounded-[3rem] text-white flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl shadow-indigo-200">
                <div className="max-w-md">
                  <h3 className="text-3xl font-black mb-4">Start your scan.</h3>
                  <p className="opacity-80 leading-relaxed font-medium">Our AI agent identifies scholarships tailored to your identity, GPA, and location.</p>
                </div>
                <button onClick={handleDiscovery} className="bg-white text-indigo-900 px-10 py-5 rounded-2xl font-black text-lg hover:scale-105 transition-all shadow-xl active:scale-95">
                  Start AI Discovery
                </button>
              </div>
            </div>
          )}

          {activeSection === AppSection.PROFILE && (
            <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100 space-y-8 animate-fadeIn">
              <h3 className="text-2xl font-black text-slate-900">My Profile</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Full Name</label>
                  <input type="text" placeholder="Name" value={profile.name} onChange={e => setProfile({...profile, name: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-100 transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-2">GPA</label>
                  <input type="text" placeholder="GPA" value={profile.gpa} onChange={e => setProfile({...profile, gpa: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-100 transition-all" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase ml-2">Achievements & Skills</label>
                <textarea placeholder="List your awards, sports, or unique skills..." value={profile.achievements} onChange={e => setProfile({...profile, achievements: e.target.value})} className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl h-32 outline-none focus:ring-2 focus:ring-indigo-100 transition-all" />
              </div>
              <button onClick={() => syncToCloud({ profile })} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95">
                Save Cloud Profile
              </button>
            </div>
          )}

          {activeSection === AppSection.MATCHES && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fadeIn">
              {matches.length === 0 ? (
                <div className="col-span-2 text-center py-20 bg-white rounded-[3rem] border border-dashed border-slate-300">
                  <p className="text-slate-400 font-bold italic">No matches discovered yet. Run a scan from the Dashboard.</p>
                </div>
              ) : matches.map(m => (
                <div key={m.id} className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-2xl transition-all group">
                  <div className="flex justify-between items-start mb-6">
                    <p className="text-3xl font-black text-indigo-600">{m.amount}</p>
                    <span className="text-indigo-600 text-[10px] font-black bg-indigo-50 px-3 py-1 rounded-lg uppercase tracking-widest">{m.matchScore}% Fit</span>
                  </div>
                  <h4 className="font-bold text-xl mb-3 text-slate-900 leading-tight">{m.name}</h4>
                  <p className="text-sm text-slate-500 line-clamp-3 mb-8 leading-relaxed font-medium">{m.reason}</p>
                  <button onClick={() => setActiveSection(AppSection.CHAT)} className="w-full py-4 bg-slate-900 text-white rounded-xl font-black text-xs hover:bg-indigo-600 transition-all shadow-md group-hover:scale-[1.02]">
                    Discuss Application Strategy
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeSection === AppSection.TRACKER && (
             <div className="bg-white rounded-[3rem] shadow-xl border border-slate-100 overflow-hidden animate-fadeIn">
                <div className="p-10 border-b border-slate-50">
                  <h3 className="text-2xl font-black">Application Hub</h3>
                </div>
                <div className="p-10 text-center text-slate-400 italic font-medium py-20">
                  Coming Soon: Live submission tracking and document storage.
                </div>
             </div>
          )}

          {activeSection === AppSection.CHAT && (
            <div className="flex flex-col h-[70vh] bg-white rounded-[3rem] border border-slate-100 shadow-2xl overflow-hidden animate-fadeIn">
              <div className="flex-1 overflow-y-auto p-10 space-y-6 bg-slate-50/20">
                {chatHistory.length === 0 && (
                  <div className="text-center py-20 space-y-4">
                    <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto text-2xl">
                      <i className="fas fa-robot"></i>
                    </div>
                    <p className="text-slate-400 font-bold text-sm italic">Ask me about essays, extracurriculars, or finding local grants.</p>
                  </div>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-6 rounded-[2rem] shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 rounded-tl-none'}`}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">{msg.parts[0].text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-8 border-t border-slate-100 flex items-center space-x-4 bg-white">
                <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleChat()} placeholder="How do I stand out in my personal statement?" className="flex-1 p-5 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-100 transition-all font-medium" />
                <button onClick={handleChat} disabled={loading} className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center hover:bg-indigo-700 transition-all shadow-lg active:scale-90 disabled:opacity-50">
                  <i className="fas fa-paper-plane"></i>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-slate-900/10 backdrop-blur-sm z-[200] flex items-center justify-center animate-fadeIn">
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl text-center space-y-6 border border-slate-100">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="font-black text-[10px] uppercase tracking-[0.2em] text-slate-900">AI Advisor is working...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;