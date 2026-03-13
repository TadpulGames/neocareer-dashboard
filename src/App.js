// App.jsx — NeoRecruit Candidate Sourcing Dashboard

import { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import './App.css';
import { auth, db } from './firebaseConfig';

// ─── Constants ─────────────────────────────────────────────────────────────────
const PMETRIC_JOB_ID  = 'Candidate Psychometric_ID=177215044969315pq0m6sh';
const TALENT_JOB_ID   = 'Candidate General Profile _ID=1770148261646fqdxn5zt8';
const ALLOWED_EMAIL   = 'tadpulgames@gmail.com';
const TRACKING_DOC    = '000000_tracking';
const PAGE_SIZE       = 20;

// ─── Email sanitizers ──────────────────────────────────────────────────────────
const sanitizeForProfile = (email) => {
  const [local, domain] = email.split('@');
  return local.replace(/\./g, '_') + domain.replace(/\./g, '_');
};
const sanitizeForInterview = (email) => email.replace(/\./g, '_');

// ─── Formatters ────────────────────────────────────────────────────────────────
const fmt = (iso) => iso
  ? new Date(iso).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
  : '—';
const fmtTs = (ts) => {
  if (!ts) return '—';
  if (ts?.toDate) return fmt(ts.toDate().toISOString());
  return fmt(ts);
};

// ─── Tag logic ─────────────────────────────────────────────────────────────────
// Primary: 000000_tracking { createdAt, updatedAt }
// Fallback: profile doc { createdAt, updatedAt } (Firestore Timestamps or ISO strings)
function toDate(val) {
  if (!val) return null;
  if (val?.toDate) return val.toDate();
  return new Date(val);
}
function getTagFromTracking(email, trackingMap, profile) {
  const today = new Date().toDateString();
 
  const created = profile?.createdAt?.toDate
    ? profile.createdAt.toDate()
    : profile?.createdAt
    ? new Date(profile.createdAt)
    : null;
 
  const updated = profile?.updatedAt?.toDate
    ? profile.updatedAt.toDate()
    : profile?.updatedAt
    ? new Date(profile.updatedAt)
    : null;
 
  if (!created) return null;
 
  if (created.toDateString() === today) return 'new';
 
  if (created.toDateString() !== today && updated && updated.toDateString() === today) return 'updated';
 
  return null; // previous
}

// ─── Firestore: load candidatelist2 + profile docs + 000000_tracking ────────
async function loadAllCandidates() {
  const [listSnap, trackSnap] = await Promise.all([
    getDoc(doc(db, 'CandidateSourcing', 'candidatelist2')),
    getDoc(doc(db, 'CandidateSourcing', '000000_tracking')),
  ]);
  if (!listSnap.exists()) return { emails: [], profiles: {}, trackingMap: {} };

  const emails = listSnap.data().emails || [];

  // Build trackingMap: email -> { createdAt, updatedAt, indexNumber }
  const trackingMap = {};
  if (trackSnap.exists()) {
    for (const entry of (trackSnap.data().entries || [])) {
      trackingMap[entry.email] = entry;
    }
  }

  // Batch-fetch all profile docs + Status docs from CandidateTalent & Pmetric
  const profiles = {};
  const interviewStatus = {};  // email -> { talentDone, pmetricDone }

  await Promise.all(emails.map(async (email) => {
    try {
      const profileKey   = sanitizeForProfile(email);
      const interviewKey = sanitizeForInterview(email);

      const [profileSnap, talentStatusSnap, pmetricStatusSnap] = await Promise.all([
        getDoc(doc(db, 'CandidateSourcing', profileKey)),
        getDoc(doc(db, 'CandidateTalent', 'Jobs', TALENT_JOB_ID, 'Candidates', interviewKey, 'Status')),
        getDoc(doc(db, 'Pmetric', 'Jobs', PMETRIC_JOB_ID, 'Candidates', interviewKey, 'Status')),
      ]);

      if (profileSnap.exists()) {
        profiles[email] = profileSnap.data();
        // Load saved email tracking if present
        if (profileSnap.data().emailTracking) {
          // will be merged into emailStatusMap after load
          profiles[email]._emailTracking = profileSnap.data().emailTracking;
        }
      }

      // isInterviewFinished is stored as the STRING "True"/"False", not boolean
      const talentData  = talentStatusSnap.exists()  ? talentStatusSnap.data()  : null;
      const pmetricData = pmetricStatusSnap.exists() ? pmetricStatusSnap.data() : null;
      const isTrue = (val) => val === true || val === 'True' || val === 'true';
      const talentDone  = !!(talentData  && isTrue(talentData.isInterviewFinished));
      const pmetricDone = !!(pmetricData && isTrue(pmetricData.isInterviewFinished));
      interviewStatus[email] = { talentDone, pmetricDone };
    } catch (_) {}
  }));


const talentDone  = Object.entries(interviewStatus).filter(([,v]) => v.talentDone).map(([e]) => e);
const pmetricDone = Object.entries(interviewStatus).filter(([,v]) => v.pmetricDone).map(([e]) => e);
const talentFailed  = emails.filter(e => !interviewStatus[e]?.talentDone);
const pmetricFailed = emails.filter(e => !interviewStatus[e]?.pmetricDone);
console.log(`🎤 CandidateTalent done (${talentDone.length}):`,  talentDone);
console.log(`🧠 Pmetric done (${pmetricDone.length}):`, pmetricDone);
console.log(`❌ Talent NOT done (${talentFailed.length}) — check these:`, talentFailed.slice(0,20));
console.log(`❌ Pmetric NOT done (${pmetricFailed.length}) — check these:`, pmetricFailed.slice(0,20));

  return { emails, profiles, trackingMap, interviewStatus };
}

// ─── Firestore: compute stats from profiles + interviewStatus ─────────────────
function computeStats(emails, profiles, interviewStatus) {
  const todayStr = new Date().toDateString();
  let filledToday = 0, interviewDone = 0, metricDone = 0;

  for (const email of emails) {
    const p  = profiles[email];
    const is = interviewStatus?.[email];
    if (p) {
      const created = p.createdAt?.toDate ? p.createdAt.toDate() : p.createdAt ? new Date(p.createdAt) : null;
      const updated = p.updatedAt?.toDate ? p.updatedAt.toDate() : p.updatedAt ? new Date(p.updatedAt) : null;
      if ((created && created.toDateString() === todayStr) || (updated && updated.toDateString() === todayStr)) filledToday++;
    }
    if (is?.talentDone)  interviewDone++;
    if (is?.pmetricDone) metricDone++;
  }
  return { filledToday, interviewDone, metricDone };
}

// ─── Firestore: fetch candidate interview ──────────────────────────────────────
async function fetchCandidateInterview(company, jobId, key) {
  const base = [company, 'Jobs', jobId, 'Candidates', key];
  try {
    const [convSnap, resultSnap, analyticsSnap, feedbackSnap, statusSnap] = await Promise.all([
      getDoc(doc(db, ...base, 'Conversation')),
      getDoc(doc(db, ...base, 'Result')),
      getDoc(doc(db, ...base, 'Analytics')),
      getDoc(doc(db, ...base, 'Feedback')),
      getDoc(doc(db, ...base, 'Status')),
    ]);
    return {
      conversation : convSnap.exists()      ? convSnap.data()      : null,
      result       : resultSnap.exists()    ? resultSnap.data()    : null,
      analytics    : analyticsSnap.exists() ? analyticsSnap.data() : null,
      feedback     : feedbackSnap.exists()  ? feedbackSnap.data()  : null,
      status       : statusSnap.exists()    ? statusSnap.data()    : null,
    };
  } catch (e) { return null; }
}

// ─── One-time bootstrap: creates 000000_tracking from real profile timestamps ──
async function bootstrapTracking() {
  const trackRef  = doc(db, 'CandidateSourcing', '000000_tracking');
  const trackSnap = await getDoc(trackRef);
  if (trackSnap.exists()) { alert('000000_tracking already exists — nothing to do.'); return; }
  const listSnap = await getDoc(doc(db, 'CandidateSourcing', 'candidatelist2'));
  const emails   = listSnap.exists() ? (listSnap.data().emails || []) : [];
  const now      = new Date().toISOString();
  const toISO    = (val) => { if (!val) return now; if (val?.toDate) return val.toDate().toISOString(); return new Date(val).toISOString(); };
  const entries  = [];
  await Promise.all(emails.map(async (email, i) => {
    try {
      const key  = sanitizeForProfile(email);
      const snap = await getDoc(doc(db, 'CandidateSourcing', key));
      const p    = snap.exists() ? snap.data() : null;
      entries.push({ email, createdAt: toISO(p?.createdAt), updatedAt: toISO(p?.updatedAt), indexNumber: i + 1 });
    } catch (_) { entries.push({ email, createdAt: now, updatedAt: now, indexNumber: i + 1 }); }
  }));
  await setDoc(doc(db, 'CandidateSourcing', '000000_tracking'), { entries, createdAt: now, updatedAt: now });
  alert('✅ 000000_tracking created with ' + entries.length + ' entries!');
}


// ─── Email API constants ──────────────────────────────────────────────────────
const SEND_EMAIL_API    = 'https://us-central1-neodonya-authentication.cloudfunctions.net/sendEmail';
const TRACKING_API      = 'https://us-central1-neodonya-authentication.cloudfunctions.net/getEmailTrackingStatus';
const EMAIL_TEMPLATE_ID = '2711042';
const EMAIL_FROM        = 'contact@neorecruit.ai';
const EMAIL_SUBJECT     = 'Complete Your Interview – NeoRecruit';

// ─── Send emails to selected candidates ───────────────────────────────────────
async function sendInterviewEmails(emailList, token) {
  const results = [];
  for (const email of emailList) {
    try {
      const res = await fetch(SEND_EMAIL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          sender: EMAIL_FROM,
          to: [email],
          subject: EMAIL_SUBJECT,
          templateId: EMAIL_TEMPLATE_ID,
          templateData: { email }
        })
      });
      const data = await res.json();
      const trackingData = data.email_id ? {
        emailId: data.email_id,
        requestId: data.request_id || null,
        sentTimestamp: new Date().toISOString(),
        recipientEmail: email
      } : null;
      results.push({ email, success: !!data.success, trackingData });
    } catch (err) {
      results.push({ email, success: false, error: err.message, trackingData: null });
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

// ─── Fetch email tracking status ──────────────────────────────────────────────
async function getEmailTrackingStatus(trackingDataList, token) {
  if (!trackingDataList.length) return [];
  try {
    const res = await fetch(TRACKING_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ trackingDataList: trackingDataList.map(td => ({
        recipientEmail: td.recipientEmail,
        emailId: td.emailId,
        sentTimestamp: td.sentTimestamp
      }))})
    });
    const data = await res.json();
    if (!data.success || !Array.isArray(data.results)) return [];
    return data.results.map(r => {
      const sorted = Array.isArray(r.events) ? [...r.events].sort((a,b) => new Date(b.date||b.timestamp) - new Date(a.date||a.timestamp)) : [];
      return { recipientEmail: r.recipientEmail, emailId: r.emailId, status: r.status || (sorted[0]?.event) || 'Sent', events: sorted };
    });
  } catch (err) {
    console.error('[tracking]', err);
    return [];
  }
}

// ─── Save email tracking data to Firestore ────────────────────────────────────
async function saveEmailTracking(email, trackingData) {
  try {
    const key = sanitizeForProfile(email);
    await updateDoc(doc(db, 'CandidateSourcing', key), { emailTracking: trackingData });
  } catch (_) {}
}

// ─── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [page,          setPage]          = useState('login'); // 'login' | 'candidates' | 'detail'
  const [user,          setUser]          = useState(null);
  const [loginLoading,  setLoginLoading]  = useState(false);
  const [loginError,    setLoginError]    = useState('');
  const [emails,        setEmails]        = useState([]);
  const [profiles,      setProfiles]      = useState({});
  const [trackingMap,     setTrackingMap]     = useState({});
  const [interviewStatus, setInterviewStatus] = useState({});
  const [stats,           setStats]           = useState({ filledToday:0, interviewDone:0, metricDone:0 });
  const [dataLoading,   setDataLoading]   = useState(false);
  const [search,        setSearch]        = useState('');
  const [filter,        setFilter]        = useState('all');
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [currentPage,   setCurrentPage]   = useState(1);
  // ── Email send & tracking state ──────────────────────────────────────────────
  const [selectedEmails,   setSelectedEmails]   = useState(new Set());
  const [emailStatusMap,   setEmailStatusMap]   = useState({}); // email -> { sent, trackingData, status, events }
  const [sendingEmail,     setSendingEmail]     = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [journeyEmail,     setJourneyEmail]     = useState(null); // email for journey popup

  const loadData = useCallback(async () => {
    setDataLoading(true);
    try {
      const { emails: em, profiles: pr, trackingMap: tm, interviewStatus: is } = await loadAllCandidates();
      const reversed = [...em].reverse();
      setEmails(reversed);
      setProfiles(pr);
      setTrackingMap(tm);
      setInterviewStatus(is || {});
      setStats(computeStats(em, pr, is || {}));
      // Restore email status from saved tracking in profiles
      const savedMap = {};
      for (const [email, profile] of Object.entries(pr)) {
        if (profile._emailTracking) {
          savedMap[email] = { sent: true, trackingData: profile._emailTracking, status: 'Sent', events: [] };
        }
      }
      if (Object.keys(savedMap).length) setEmailStatusMap(prev => ({ ...savedMap, ...prev }));
    } catch (e) { console.error(e); }
    setDataLoading(false);
  }, []);

  const getToken = async () => auth.currentUser?.getIdToken();

  const toggleSelect = (email) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  };

  const handleSendEmails = async () => {
    const toSend = [...selectedEmails];
    if (!toSend.length) { alert('Select at least one candidate.'); return; }
    if (!window.confirm(`Send interview email to ${toSend.length} candidate(s)?`)) return;
    setSendingEmail(true);
    try {
      const token = await getToken();
      const results = await sendInterviewEmails(toSend, token);
      const newMap = { ...emailStatusMap };
      for (const r of results) {
        if (r.success && r.trackingData) {
          newMap[r.email] = { sent: true, trackingData: r.trackingData, status: 'Sent', events: [] };
          await saveEmailTracking(r.email, r.trackingData);
        }
      }
      setEmailStatusMap(newMap);
      setSelectedEmails(new Set());
      const ok = results.filter(r => r.success).length;
      alert(`✅ ${ok}/${toSend.length} emails sent successfully!`);
    } catch (e) { alert('Failed to send emails: ' + e.message); }
    setSendingEmail(false);
  };

  const handleRefreshTracking = async () => {
    const withTracking = Object.values(emailStatusMap).filter(s => s.trackingData);
    if (!withTracking.length) { alert('No sent emails to refresh.'); return; }
    setRefreshingStatus(true);
    try {
      const token = await getToken();
      const results = await getEmailTrackingStatus(withTracking.map(s => s.trackingData), token);
      const newMap = { ...emailStatusMap };
      for (const r of results) {
        if (newMap[r.recipientEmail]) {
          newMap[r.recipientEmail] = { ...newMap[r.recipientEmail], status: r.status, events: r.events };
        }
      }
      setEmailStatusMap(newMap);
    } catch (e) { alert('Failed to refresh: ' + e.message); }
    setRefreshingStatus(false);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) { setPage('login'); setUser(null); return; }
      setUser(u);
      setPage('candidates');
      window.history.pushState({}, '', '/candidates');
      loadData();
    });
    return unsub;
  }, [loadData]);

  

  const handleLogin = async () => {
    setLoginLoading(true); setLoginError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ login_hint: ALLOWED_EMAIL });
      const result = await signInWithPopup(auth, provider);
      if (result.user.email !== ALLOWED_EMAIL) {
        await signOut(auth);
        setLoginError('Access denied. Only the authorised admin account can sign in.');
      }
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user')
        setLoginError(err.message || 'Sign-in failed. Please try again.');
    }
    setLoginLoading(false);
  };

  const handleLogout = () => signOut(auth).then(() => {
    setPage('login'); setUser(null); setEmails([]); setProfiles({}); setTrackingMap({}); setInterviewStatus({});
    window.history.pushState({}, '', '/');
  });

  const openDetail = (email) => {
    setSelectedEmail(email); setPage('detail');
    window.history.pushState({}, '', '/candidates/' + encodeURIComponent(email));
  };
  const closeDetail = () => {
    setSelectedEmail(null); setPage('candidates');
    window.history.pushState({}, '', '/candidates');
  };

  // ── Derived rows ─────────────────────────────────────────────────────────────
  const allRows = emails.map((email, ri) => {
    const p         = profiles[email];
    const entry     = trackingMap[email];
    const tag       = getTagFromTracking(email, trackingMap, p);
    // addedAt: prefer tracking updatedAt, fall back to profile updatedAt
    const rawAddedAt = p?.updatedAt?.toDate
  ? p.updatedAt.toDate().toISOString()
  : p?.updatedAt || null;
    const addedAt    = rawAddedAt;
    const is         = interviewStatus[email] || {};
    const talentDone  = !!is.talentDone;
    const pmetricDone = !!is.pmetricDone;
    return { email, ri, oi: emails.length - 1 - ri, tag, addedAt, talentDone, pmetricDone };
  });

  const newCount    = allRows.filter(r => r.tag === 'new').length;
  const updCount    = allRows.filter(r => r.tag === 'updated').length;
  const oldCount    = allRows.length - newCount - updCount;
  const talentCount = allRows.filter(r => r.talentDone).length;
  const pmetricCount= allRows.filter(r => r.pmetricDone).length;
  const bothCount   = allRows.filter(r => r.talentDone && r.pmetricDone).length;

  const filtered = allRows.filter(({ email, tag, talentDone, pmetricDone }) => {
    if (!email.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'new')     return tag === 'new';
    if (filter === 'updated') return tag === 'updated';
    if (filter === 'old')     return !tag;
    if (filter === 'talent')  return talentDone;
    if (filter === 'pmetric') return pmetricDone;
    if (filter === 'both')    return talentDone && pmetricDone;
    
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows   = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset to page 1 on filter/search change
  useEffect(() => { setCurrentPage(1); }, [filter, search]);

  // ── Render ───────────────────────────────────────────────────────────────────
  if (page === 'login') return <LoginScreen loading={loginLoading} error={loginError} onLogin={handleLogin} />;
  if (page === 'detail') return <CandidateDetail email={selectedEmail} profiles={profiles} onBack={closeDetail} />;

  return (
    <div className="app">
      <Sidebar user={user} onLogout={handleLogout} />
      <main className="main">
        {/* Topbar */}
        <div className="topbar">
          <div>
            <h1 className="page-title">Candidate Inbox</h1>
            <div className="page-sub">CandidateSourcing › candidatelist2 · {emails.length} candidates</div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {selectedEmails.size > 0 && (
              <button className="refresh-btn" onClick={handleSendEmails} disabled={sendingEmail}
                style={{background:'#2563eb',color:'#fff',borderColor:'#2563eb'}}>
                {sendingEmail ? '⏳ Sending…' : `✉ Send Email (${selectedEmails.size})`}
              </button>
            )}
            <button className="refresh-btn" onClick={handleRefreshTracking} disabled={refreshingStatus}
              title="Refresh email delivery status">
              {refreshingStatus ? '⏳' : '📬'} {refreshingStatus ? 'Refreshing…' : 'Refresh Status'}
            </button>
            <button className="refresh-btn" onClick={loadData} disabled={dataLoading}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={dataLoading ? 'spin' : ''}>
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Stats row 1 — counts */}
        <div className="stats-grid">
          {[
            { label:'Total',      value:emails.length,        cls:'c-blue'  },
            { label:'New',        value:newCount,             cls:'c-green' },
            { label:'Updated',    value:updCount,             cls:'c-amber' },
            { label:'Previous',   value:oldCount,             cls:'c-slate' },
          ].map(({ label, value, cls }) => (
            <div className={`stat-card ${cls}`} key={label}>
              <div className="stat-val">{dataLoading ? '—' : value}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>

        {/* Stats row 2 — activity */}
        <div className="stats-grid stats-grid-3" style={{marginBottom:24}}>
          {[
            { label:'Filled Today',      value:stats.filledToday,    cls:'c-violet', icon:'📝' },
            { label:'CandidateTalent',     value:stats.interviewDone,  cls:'c-teal',   icon:'🎤' },
            { label:'Pmetric',             value:stats.metricDone,     cls:'c-purple', icon:'🧠' },
          ].map(({ label, value, cls, icon }) => (
            <div className={`stat-card ${cls}`} key={label} style={{gridColumn:'span 1'}}>
              <div className="stat-icon">{icon}</div>
              <div className="stat-val" style={{fontSize:26}}>{dataLoading ? '—' : value}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="controls">
          <div className="search-wrap">
            <svg className="search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input className="search-input" placeholder="Search emails…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="search-clear" onClick={() => setSearch('')}>×</button>}
          </div>
          <div className="filter-row">
            {[
              { id:'all',     label:`All (${emails.length})` },
              { id:'new',     label:`● New (${newCount})` },
              { id:'updated', label:`↑ Updated (${updCount})` },
              { id:'old',     label:`— Previous (${oldCount})` },
              { id:'talent',  label:`🎤 CandidateTalent (${talentCount})` },
              { id:'pmetric', label:`🧠 Pmetric (${pmetricCount})` },
              { id:'both',    label:`✅ Both (${bothCount})` },
            ].map(({ id, label }) => (
              <button key={id} className={`filter-btn f-${id}${filter===id?' active':''}`} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="table-wrap">
          {dataLoading ? (
            <div className="empty-state"><div className="spinner"/></div>
          ) : pageRows.length === 0 ? (
            <div className="empty-state">No results found</div>
          ) : (
            <table className="data-table">
              <thead><tr>
                <th style={{width:36}}>
                  <input type="checkbox" onChange={e => {
                    if (e.target.checked) setSelectedEmails(new Set(pageRows.filter(r => !interviewStatus[r.email]?.talentDone && !interviewStatus[r.email]?.pmetricDone).map(r => r.email)));
                    else setSelectedEmails(new Set());
                  }} style={{cursor:'pointer'}}/>
                </th>
                <th style={{width:48}}>#</th>
                <th>Email</th>
                <th>Status</th>
                <th>CandidateTalent Status</th>
                <th>Pmetric Status</th>
                <th>Email Sent</th>
                <th>Last Updated</th>
                <th style={{width:32}}></th>
              </tr></thead>
              <tbody>
                {pageRows.map(({ email, oi, tag, addedAt, talentDone, pmetricDone }) => {
                  const rowCls = tag==='new' ? 'row row-hi row-new' : tag==='updated' ? 'row row-hi row-updated' : 'row row-lo';
                  const avCls  = tag==='new' ? 'avatar av-new' : tag==='updated' ? 'avatar av-updated' : 'avatar av-old';
                  return (
                    <tr key={email} className={rowCls} style={{cursor:'pointer'}}>
                      <td onClick={e => e.stopPropagation()}>
                        <input type="checkbox"
                          checked={selectedEmails.has(email)}
                          onChange={() => toggleSelect(email)}
                          style={{cursor:'pointer'}}
                        />
                      </td>
                      <td className="td-num" onClick={() => openDetail(email)}>{oi+1}</td>
                      <td onClick={() => openDetail(email)}>
                        <div className="email-cell">
                          <div className={avCls}>{email[0].toUpperCase()}</div>
                          <span className="email-addr">{email}</span>
                        </div>
                      </td>
                      <td onClick={() => openDetail(email)}>
                        {tag==='new'
                          ? <span className="badge b-new">● New</span>
                          : tag==='updated'
                          ? <span className="badge b-updated">↑ Updated</span>
                          : <span className="badge b-old">— Previous</span>}
                      </td>
                      <td onClick={() => openDetail(email)}>
  {talentDone
    ? <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:12,fontSize:11,fontWeight:500,background:'#d1fae5',color:'#059669'}}>✅ Done</span>
    : <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:12,fontSize:11,fontWeight:500,background:'#1e2d3d',color:'#475569'}}>— Pending</span>}
</td>
<td onClick={() => openDetail(email)}>
  {pmetricDone
    ? <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:12,fontSize:11,fontWeight:500,background:'#d1fae5',color:'#059669'}}>✅ Done</span>
    : <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:12,fontSize:11,fontWeight:500,background:'#1e2d3d',color:'#475569'}}>— Pending</span>}
</td>
                      <td onClick={e => { e.stopPropagation(); emailStatusMap[email] && setJourneyEmail(email); }}>
                        <EmailStatusBadge status={emailStatusMap[email]} />
                      </td>
                      <td className="td-date" onClick={() => openDetail(email)}>{fmt(addedAt)}</td>
                      <td onClick={() => openDetail(email)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3d5068" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination">
            <button className="page-btn" onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage===1}>← Prev</button>
            <div className="page-numbers">
              {(() => {
                // Show up to 7 page numbers with ellipsis
                const pages = [];
                const delta = 2;
                const left  = Math.max(1, currentPage - delta);
                const right = Math.min(totalPages, currentPage + delta);
                if (left > 1) { pages.push(1); if (left > 2) pages.push('…'); }
                for (let i = left; i <= right; i++) pages.push(i);
                if (right < totalPages) { if (right < totalPages - 1) pages.push('…'); pages.push(totalPages); }
                return pages.map((p, i) =>
                  p === '…'
                    ? <span key={`e${i}`} className="page-ellipsis">…</span>
                    : <button key={p} className={`page-num${p===currentPage?' page-num-active':''}`} onClick={() => setCurrentPage(p)}>{p}</button>
                );
              })()}
            </div>
            <button className="page-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage===totalPages}>Next →</button>
          </div>
        )}
      </main>
      {/* Email Journey Popup */}
      {journeyEmail && emailStatusMap[journeyEmail] && (
        <EmailJourneyPopup
          email={journeyEmail}
          statusData={emailStatusMap[journeyEmail]}
          onClose={() => setJourneyEmail(null)}
        />
      )}
    </div>
  );
}

// ─── Candidate Detail ──────────────────────────────────────────────────────────
function CandidateDetail({ email, profiles, onBack }) {
  const profileKey   = sanitizeForProfile(email);
  const interviewKey = sanitizeForInterview(email);
  const profile      = profiles[email] || null;

  const [tab,      setTab]      = useState('profile');
  const [pmetric,  setPmetric]  = useState(null);
  const [talent,   setTalent]   = useState(null);
  const [pLoading, setPLoading] = useState(false);
  const [tLoading, setTLoading] = useState(false);

  const loadPmetric = useCallback(async () => {
    if (pmetric) { setTab('pmetric'); return; }
    setPLoading(true); setTab('pmetric');
    setPmetric(await fetchCandidateInterview('Pmetric', PMETRIC_JOB_ID, interviewKey));
    setPLoading(false);
  }, [pmetric, interviewKey]);

  const loadTalent = useCallback(async () => {
    if (talent) { setTab('talent'); return; }
    setTLoading(true); setTab('talent');
    setTalent(await fetchCandidateInterview('CandidateTalent', TALENT_JOB_ID, interviewKey));
    setTLoading(false);
  }, [talent, interviewKey]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark">N</div>
          <div><div className="logo-name">NeoRecruit</div><div className="logo-tag">Sourcing</div></div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-item" onClick={onBack} style={{cursor:'pointer'}}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Back to list
          </div>
        </nav>
      </aside>
      <main className="main">
        <div className="topbar" style={{marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            <button className="back-btn" onClick={onBack}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div>
              <h1 className="page-title">{email}</h1>
              <div className="page-sub">Profile key: {profileKey} · Interview key: {interviewKey}</div>
            </div>
          </div>
        </div>

        <div className="tab-row">
          <button className={`tab-btn${tab==='profile'?' tab-active':''}`} onClick={() => setTab('profile')}>Profile</button>
          <button className={`tab-btn${tab==='pmetric'?' tab-active':''}`} onClick={loadPmetric}>Pmetric</button>
          <button className={`tab-btn${tab==='talent'?' tab-active':''}`} onClick={loadTalent}>CandidateTalent</button>
        </div>

        {tab === 'profile' && (
          !profile
            ? <div className="empty-state">No profile found for key: <code>{profileKey}</code></div>
            : <ProfileTab profile={profile} />
        )}
        {tab === 'pmetric' && (
          pLoading ? <div className="empty-state"><div className="spinner"/></div>
          : !pmetric ? <div className="empty-state">No Pmetric data found.</div>
          : <InterviewTab data={pmetric} />
        )}
        {tab === 'talent' && (
          tLoading ? <div className="empty-state"><div className="spinner"/></div>
          : !talent ? <div className="empty-state">No CandidateTalent data found.</div>
          : <InterviewTab data={talent} />
        )}
      </main>
    </div>
  );
}

// ─── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab({ profile }) {
  const fields = [
    ['First Name',       profile.firstName],
    ['Last Name',        profile.lastName],
    ['Email',            profile.userEmail],
    ['Sanitized Email',  profile.sanitizedEmail],
    ['Phone',            profile.phone],
    ['Location',         profile.location],
    ['LinkedIn',         profile.linkedin],
    ['Education',        profile.education],
    ['Desired Roles',    profile.desiredRoles],
    ['Work Preference',  profile.workLocationPreference],
    ['Salary',           profile.salaryAmount ? `${profile.salaryCurrency||''} ${profile.salaryAmount} / ${profile.salaryPeriod||''}` : null],
    ['Joining Timeline', profile.joiningTimeline ? `${profile.joiningTimeline} days` : null],
    ['Interview Done',   profile.isInterviewDone ? 'Yes' : 'No'],
    ['Metric Done',      profile.isMetricDone    ? 'Yes' : 'No'],
    ['CV File',          profile.cvFileName],
    ['CV Status',        profile.cvExtractionStatus],
    ['CV Message',       profile.cvExtractionMessage],
    ['CV Download',      profile.cvDownloadURL],
    ['Submitted At',     profile.submittedAt ? fmt(profile.submittedAt) : null],
    ['Created At',       fmtTs(profile.createdAt)],
    ['Updated At',       fmtTs(profile.updatedAt)],
  ];
  return (
    <div className="detail-grid">
      <div className="detail-card">
        <div className="card-heading">Personal Details</div>
        <div className="field-list">
          {fields.filter(([,v]) => v).map(([label, val]) => (
            <div className="field-row" key={label}>
              <span className="field-label">{label}</span>
              <span className="field-val">
                {label === 'LinkedIn' || label === 'CV Download'
                  ? <a href={val} target="_blank" rel="noreferrer" className="link">{label === 'CV Download' ? 'Download CV ↗' : val}</a>
                  : label === 'Desired Roles'
                  ? <span style={{whiteSpace:'pre-wrap',lineHeight:1.6}}>{val}</span>
                  : val}
              </span>
            </div>
          ))}
        </div>
      </div>
      {profile.cvRawData && (
        <div className="detail-card" style={{gridColumn:'1/-1'}}>
          <div className="card-heading">CV Raw Text</div>
          <div className="cv-text">{profile.cvRawData}</div>
        </div>
      )}
    </div>
  );
}

// ─── Interview Tab ─────────────────────────────────────────────────────────────
function InterviewTab({ data }) {
  const [section, setSection] = useState('conversation');
  return (
    <div>
      <div className="sub-tab-row">
        {['conversation','result','analytics','feedback','status'].map(s => (
          <button key={s} className={`sub-tab-btn${section===s?' sub-active':''}`} onClick={() => setSection(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div className="detail-card" style={{marginTop:14}}>
        {section === 'conversation' && <ConversationView conv={data.conversation} />}
        {section === 'result'       && <KeyValueView data={data.result}    label="Result" />}
        {section === 'analytics'    && <KeyValueView data={data.analytics} label="Analytics" sorted />}
        {section === 'feedback'     && <KeyValueView data={data.feedback}  label="Feedback" />}
        {section === 'status'       && <KeyValueView data={data.status}    label="Status" />}
      </div>
    </div>
  );
}

function ConversationView({ conv }) {
  if (!conv?.ChatHistory?.length) return <div className="empty-state" style={{padding:32}}>No conversation found.</div>;
  return (
    <div className="chat-wrap">
      <div className="card-heading" style={{marginBottom:16}}>Conversation ({conv.ChatHistory.length} messages)</div>
      {conv.ChatHistory.map((msg, i) => (
        <div key={i} className="chat-turn">
          {msg.Prompt && (
            <div className="chat-bubble user-bubble">
              <div className="bubble-meta"><span className="bubble-role">Candidate</span><span className="bubble-time">{msg.Prompt_Time||''}</span></div>
              <div className="bubble-text">{msg.Prompt}</div>
            </div>
          )}
          {msg.Response && (
            <div className="chat-bubble ai-bubble">
              <div className="bubble-meta"><span className="bubble-role">Interviewer</span><span className="bubble-time">{msg.Response_Time||''}</span></div>
              <div className="bubble-text">{msg.Response}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function KeyValueView({ data, label, sorted }) {
  if (!data) return <div className="empty-state" style={{padding:32}}>No {label} data found.</div>;
  let entries = Object.entries(data);
  if (sorted) entries = entries.sort(([a],[b]) => a.localeCompare(b));
  return (
    <div>
      <div className="card-heading" style={{marginBottom:16}}>{label}</div>
      <div className="field-list">
        {entries.map(([key, val]) => (
          <div className="field-row" key={key}>
            <span className="field-label" style={{fontFamily:'monospace',fontSize:10}}>{key}</span>
            <span className="field-val" style={{wordBreak:'break-word'}}>{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── Email Status Badge ────────────────────────────────────────────────────────
function EmailStatusBadge({ status }) {
  if (!status?.sent) return <span className="badge b-old" style={{fontSize:10}}>Not Sent</span>;
  const s = status.status || 'Sent';
  const cfg = {
    Clicked:      { bg:'#d1fae5', color:'#059669', icon:'🖱️' },
    Opened:       { bg:'#ddd6fe', color:'#7c3aed', icon:'👁️' },
    Delivered:    { bg:'#cffafe', color:'#0891b2', icon:'✅' },
    'Hard Bounced':{ bg:'#fee2e2', color:'#dc2626', icon:'❌' },
    'Soft Bounced':{ bg:'#fef3c7', color:'#d97706', icon:'⚠️' },
    Sent:         { bg:'#d1fae5', color:'#059669', icon:'📧' },
  }[s] || { bg:'#e5e7eb', color:'#6b7280', icon:'📧' };
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      padding:'3px 8px', borderRadius:12, fontSize:11, fontWeight:500,
      background:cfg.bg, color:cfg.color, cursor: 'pointer'
    }} title="Click to view email journey">
      {cfg.icon} {s}
    </span>
  );
}

// ─── Email Journey Popup ───────────────────────────────────────────────────────
function EmailJourneyPopup({ email, statusData, onClose }) {
  const events = statusData?.events || [];
  const sorted = [...events].sort((a,b) => new Date(b.date||b.timestamp||0) - new Date(a.date||a.timestamp||0));
  const getConfig = (type) => ({
    processed:     { icon:'⚡', color:'#6b7280', title:'Processed' },
    delivered:     { icon:'✅', color:'#0891b2', title:'Delivered' },
    opened:        { icon:'👁️', color:'#7c3aed', title:'Opened' },
    clicked:       { icon:'🖱️', color:'#059669', title:'Clicked' },
    'soft-bounced':{ icon:'⚠️', color:'#d97706', title:'Soft Bounce' },
    'hard-bounced':{ icon:'❌', color:'#dc2626', title:'Hard Bounce' },
    spam:          { icon:'🚫', color:'#dc2626', title:'Marked Spam' },
    unsubscribed:  { icon:'📤', color:'#6b7280', title:'Unsubscribed' },
  }[type?.toLowerCase()] || { icon:'📧', color:'#6b7280', title: type || 'Email Event' });
  const fmtEvt = (d) => d ? new Date(d).toLocaleString('en-IN', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}} onClick={onClose}>
      <div style={{background:'#0f1923',border:'1px solid #1e2d3d',borderRadius:12,width:520,maxHeight:'80vh',display:'flex',flexDirection:'column',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{padding:'16px 20px',borderBottom:'1px solid #1e2d3d',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div style={{color:'#e2e8f0',fontWeight:600,fontSize:15}}>📬 Email Journey</div>
            <div style={{color:'#64748b',fontSize:12,marginTop:2}}>{email}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#64748b',cursor:'pointer',fontSize:18,lineHeight:1}}>×</button>
        </div>
        {/* Tracking info */}
        {statusData.trackingData && (
          <div style={{padding:'12px 20px',borderBottom:'1px solid #1e2d3d',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {[
              ['Sent At', fmtEvt(statusData.trackingData.sentTimestamp)],
              ['Current Status', statusData.status || 'Sent'],
            ].map(([l,v]) => (
              <div key={l}>
                <div style={{color:'#64748b',fontSize:10,textTransform:'uppercase',letterSpacing:'0.05em'}}>{l}</div>
                <div style={{color:'#e2e8f0',fontSize:13,fontWeight:500,marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>
        )}
        {/* Timeline */}
        <div style={{flex:1,overflowY:'auto',padding:'16px 20px'}}>
          <div style={{color:'#94a3b8',fontSize:12,marginBottom:12,fontWeight:500}}>EVENT TIMELINE</div>
          {sorted.length === 0 ? (
            <div style={{color:'#475569',fontSize:13,textAlign:'center',padding:'24px 0'}}>No tracking events yet. Events appear after delivery.</div>
          ) : sorted.map((ev, i) => {
            const cfg = getConfig(ev.event);
            return (
              <div key={i} style={{display:'flex',gap:12,marginBottom:16}}>
                <div style={{width:32,height:32,borderRadius:'50%',background:'#1e2d3d',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>{cfg.icon}</div>
                <div style={{flex:1}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{color:cfg.color,fontWeight:600,fontSize:13}}>{cfg.title}</span>
                    <span style={{color:'#475569',fontSize:11}}>{fmtEvt(ev.date||ev.timestamp)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{padding:'12px 20px',borderTop:'1px solid #1e2d3d',display:'flex',justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{padding:'7px 16px',background:'#1e2d3d',color:'#94a3b8',border:'none',borderRadius:6,cursor:'pointer',fontSize:13}}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ user, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">N</div>
        <div><div className="logo-name">NeoRecruit</div><div className="logo-tag">Sourcing</div></div>
      </div>
      <nav className="sidebar-nav">
        <div className="nav-item active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Candidates
        </div>
      </nav>
      <div className="sidebar-footer">
        <div className="admin-pill">
          <div className="admin-avatar">{(user?.email?.[0]||'A').toUpperCase()}</div>
          <div className="admin-info">
            <div className="admin-name">{user?.displayName||'Admin'}</div>
            <div className="admin-email">{user?.email}</div>
          </div>
        </div>
        <button className="logout-btn" onClick={onLogout}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sign out
        </button>
      </div>
    </aside>
  );
}

// ─── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ loading, error, onLogin }) {
  return (
    <div className="fullscreen-center login-bg">
      <div className="login-card">
        <div className="login-logo"><div className="logo-mark" style={{width:44,height:44,fontSize:18}}>N</div></div>
        <div className="login-title">NeoRecruit Sourcing</div>
        <div className="login-sub">Sign in with your Google admin account.</div>
        <button className="google-btn" onClick={onLogin} disabled={loading}>
          {loading ? <span className="spinner" style={{width:18,height:18,borderWidth:2}}/> : (
            <>
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.6 32.9 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.5 26.8 36.5 24 36.5c-5.2 0-9.6-3.1-11.3-7.6l-6.5 5C9.5 39.5 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.2 5.2C36.9 36.2 44 31 44 24c0-1.3-.1-2.6-.4-3.9z"/>
              </svg>
              Continue with Google
            </>
          )}
        </button>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}