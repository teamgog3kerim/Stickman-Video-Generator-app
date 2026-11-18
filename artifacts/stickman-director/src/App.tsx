import { useEffect, useMemo, useState } from 'react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AudioLines, Check, ChevronDown, Clapperboard, Copy, Download, FileText, Film, FolderOpen, Layers3, Menu, Mic2, MoreHorizontal, Plus, Search, Sparkles, Trash2, WandSparkles, X } from 'lucide-react';
import './workspace.css';

type Engine = 'model' | 'code';
type Scene = { id: string; title: string; narration: string; visualDirection: string; seconds: number };
type Project = { id: string; title: string; topic: string; script: string; engine: Engine; styleId: string; aspectRatio: '16:9' | '9:16'; durationSeconds: number; voiceover: boolean; subtitles: boolean; soundEffects: boolean; scenes: Scene[]; updatedAt: number };
type Style = { id: string; name: string; engine: Engine; image?: string; desc: string };
const styles: Style[] = [
  {id:'A1',name:'A1 Classic Black & White',engine:'model',image:'a1-classic.jpg',desc:'Loose monochrome linework, expressive and direct.'},
  {id:'A2',name:'A2 Modern Pop',engine:'model',image:'a2-modern-pop.jpg',desc:'Bright contemporary stick figures and clean sets.'},
  {id:'A3',name:'A3 Prehistoric Cave',engine:'model',image:'a3-cave.jpg',desc:'Earthy cave-life comedy with hand-drawn texture.'},
  {id:'A4',name:'A4 Cozy Storytelling',engine:'model',image:'a4-cozy.jpg',desc:'Gentle everyday scenes, warm and observant.'},
  {id:'A5',name:'A5 Historical Cartoon',engine:'model',image:'a5-history.jpg',desc:'Playful historical settings and character-led scenes.'},
  {id:'A6',name:'A6 Amber Noir',engine:'model',image:'a6-amber.jpg',desc:'Cinematic shadows, amber light and mystery.'},
  {id:'A7',name:'A7 Rubber Hose Animation',engine:'model',image:'a7-rubber-hose.jpg',desc:'Bouncy vintage cartoon motion and charm.'},
  {id:'B1',name:'B1 Minimal Line Art',engine:'code',image:'b1-minimal.jpg',desc:'Crisp sketch lines with plenty of breathing room.'},
  {id:'B2',name:'B2 Colorful Hand-Drawn',engine:'code',image:'b2-colorful.jpg',desc:'Handmade scenes with bold color and character.'},
  {id:'B3',name:'B3 Retro TV',engine:'code',image:'b3-retro-tv.jpg',desc:'Broadcast-era framing, restrained colors, big captions.'},
  {id:'B4',name:'B4 Survival Thriller',engine:'code',image:'b4-survival.jpg',desc:'Tense, graphic panels built around a clear rule.'},
  {id:'B5',name:'B5 Character Explainer',engine:'code',image:'b5-character.jpg',desc:'Character-driven visual metaphors for complex ideas.'},
   {id:'B6',name:'B6 Dynamic Meme Animation',engine:'code',image:'b6-meme.jpg',desc:'Punchy panels, expressive movement and fast visual rhythm.'},
  {id:'B7',name:'B7 Pixel Theater',engine:'code',image:'b7-pixel.jpg',desc:'Retro pixel scenes with game-like staging.'},
];
const imageUrl = (file?: string) => file ? `${import.meta.env.BASE_URL}images/${file}` : '';
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const blankProject = (): Project => ({ id: makeId(), title:'Untitled video', topic:'', script:'', engine:'model', styleId:'A2', aspectRatio:'16:9', durationSeconds:60, voiceover:true, subtitles:true, soundEffects:false, scenes:[], updatedAt:Date.now() });
const STORAGE_KEY = 'stickman-director-projects-v1';
function readProjects(): Project[] { try { const data = localStorage.getItem(STORAGE_KEY); return data ? JSON.parse(data) as Project[] : []; } catch { return []; } }
const btnBase = 'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed';

function App() {
  return <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><WorkspaceApp /></WouterRouter>;
}

function WorkspaceApp() {
  const [location, setLocation] = useLocation();
  const [projects, setProjects] = useState<Project[]>(readProjects);
  const [current, setCurrent] = useState<Project>(() => readProjects()[0] ?? blankProject());
  const [saved, setSaved] = useState(true);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); }, [projects]);
  useEffect(() => { const timer = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timer); }, [toast]);
  const notify = (text: string) => setToast(text);
  const patch = (updates: Partial<Project>) => { setCurrent(prev => ({...prev,...updates,updatedAt:Date.now()})); setSaved(false); };
  const save = (p = current) => {
    const next = {...p, updatedAt:Date.now()};
    setProjects(prev => [next, ...prev.filter(item => item.id !== next.id)]);
    setCurrent(next); setSaved(true); notify('Project saved locally');
  };
  const createProject = () => { const p = blankProject(); setCurrent(p); setProjects(prev => [p,...prev.filter(item=>item.id!==p.id)]); setSaved(true); setLocation('/'); setMobileNav(false); notify('New project ready'); };
  const openProject = (p: Project) => { setCurrent(p); setSaved(true); setLocation('/'); };
  const addScene = () => patch({scenes:[...current.scenes,{id:makeId(),title:`Scene ${current.scenes.length+1}`,narration:'Add the line spoken in this moment.',visualDirection:'Describe the composition, character action, and setting.',seconds:6}]});
  const updateScene = (id:string, updates:Partial<Scene>) => patch({scenes:current.scenes.map(scene=>scene.id===id?{...scene,...updates}:scene)});
  const moveScene = (index:number, delta:number) => { const n=index+delta; if(n<0||n>=current.scenes.length)return; const arr=[...current.scenes]; [arr[index],arr[n]]=[arr[n],arr[index]]; patch({scenes:arr}); };
  const deleteScene = (id:string) => patch({scenes:current.scenes.filter(scene=>scene.id!==id)});
  const draftScenes = () => {
    const source=(current.script.trim()||current.topic.trim()||'A simple idea worth explaining').replace(/\n/g,' ').trim();
    const sentences=source.split(/(?<=[.!?])\s+/).filter(Boolean);
    const beats=sentences.length>1?sentences.slice(0,4):[
      `Start with the question: what does ${current.topic||'this idea'} look like in everyday life?`,
      `Show the key change that makes ${current.topic||'the idea'} easier to understand.`,
      `Land on one memorable takeaway the viewer can use.`
    ];
    const titles=['The hook','A closer look','The turning point','The takeaway'];
    const scenes=beats.map((line,i)=>({id:makeId(),title:titles[i]||`Beat ${i+1}`,narration:line,visualDirection:['Open on a clear, simple visual metaphor. Introduce one character and one focal object.','Move in closer; use a small detail or contrast to make the concept tangible.','Shift the composition to show cause and effect. Keep the action readable.','Resolve with a quiet final frame and one visual cue to remember.'][i]||'Build a distinct visual beat that supports this line.',seconds:Math.max(4,Math.round(current.durationSeconds/beats.length))}));
    patch({scenes}); notify('A starter storyboard draft is ready to edit');
  };
  const brief = () => {
    const selected=styles.find(s=>s.id===current.styleId);
    return `STICKMAN VIDEO DIRECTOR — PRODUCTION BRIEF\n${current.title}\n\nIDEA\n${current.topic||'—'}\n\nSCRIPT\n${current.script||'—'}\n\nPRODUCTION SETUP\nEngine: ${current.engine==='model'?'Model Engine':'Code Engine'}\nStyle: ${selected?.name||'—'}\nFormat: ${current.aspectRatio}\nTarget duration: ${current.durationSeconds} seconds\nVoiceover: ${current.voiceover?'On':'Off'} | Subtitles: ${current.subtitles?'On':'Off'} | Sound effects: ${current.soundEffects?'On':'Off'}\n\nSTORYBOARD (${current.scenes.length} scenes)\n${current.scenes.map((s,i)=>`${String(i+1).padStart(2,'0')} · ${s.title} · ${s.seconds}s\nNARRATION: ${s.narration}\nVISUAL: ${s.visualDirection}`).join('\n\n')}\n\nDraft brief only. No video has been generated or rendered.`;
  };
  const copyBrief = async () => { try { await navigator.clipboard.writeText(brief()); notify('Production brief copied'); } catch { notify('Clipboard unavailable in this browser'); } };
  const downloadBrief = () => { const blob=new Blob([brief()],{type:'text/plain'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`${current.title.trim().replace(/[^a-z0-9]+/gi,'-').toLowerCase()||'production-brief'}.txt`; a.click(); URL.revokeObjectURL(url); notify('Production brief downloaded'); };

  return <div className="app-shell grain">
    <aside className={`sidebar ${mobileNav?'nav-open':''}`}>
      <div className="brand"><div className="brand-mark"><Clapperboard size={19}/></div><div><div className="brand-name">STICKMAN<span> / DIRECTOR</span></div><div className="brand-kicker">A STORYBOARD WORKSPACE</div></div><button className="mobile-close" onClick={()=>setMobileNav(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <div className="workspace-label mono">WORKSPACE <span>01</span></div>
      <nav className="nav-links">
        <button className={`nav-item ${location==='/'?'active':''}`} onClick={()=>{setLocation('/');setMobileNav(false)}}><Layers3 size={17}/>Storyboard <span className="nav-key">⌘ 1</span></button>
        <button className={`nav-item ${location==='/projects'?'active':''}`} onClick={()=>{setLocation('/projects');setMobileNav(false)}}><FolderOpen size={17}/>Projects <span className="nav-count">{projects.length}</span></button>
        <button className={`nav-item ${location==='/styles'?'active':''}`} onClick={()=>{setLocation('/styles');setMobileNav(false)}}><Film size={17}/>Style library</button>
      </nav>
      <button className="new-project" onClick={createProject}><Plus size={16}/> New project</button>
      <div className="side-divider"/>
      <div className="side-note"><div className="side-note-icon"><WandSparkles size={16}/></div><div><strong>Make the brief first.</strong><p>Shape the story, frame by frame. Generate or render elsewhere when you’re ready.</p></div></div>
      <div className="sidebar-bottom"><div className="avatar">SD</div><div><strong>Director’s desk</strong><span>Local workspace</span></div><span className="local-dot"/></div>
    </aside>
    {mobileNav&&<button className="mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close menu"/>}
    <main className="main-area">
      <header className="topbar"><button className="hamburger" onClick={()=>setMobileNav(true)} aria-label="Open navigation"><Menu size={20}/></button><div className="crumb"><span>Studio</span><span className="crumb-slash">/</span><strong>{location==='/projects'?'Projects':location==='/styles'?'Style library':'Storyboard'}</strong></div><div className="top-actions"><span className="local-save"><i className={saved?'saved-dot':'unsaved-dot'}/>{saved?'All changes saved':'Unsaved changes'}</span><button className="btn btn-quiet" onClick={()=>save()}><Check size={15}/>Save project</button><button className="btn btn-primary" onClick={downloadBrief}><Download size={15}/>Export brief</button></div></header>
      <div className="content">
        <Switch>
          <Route path="/projects"><ProjectsPage projects={projects} create={createProject} open={openProject} rename={(p,title)=>{const next={...p,title,updatedAt:Date.now()};setProjects(old=>old.map(x=>x.id===p.id?next:x));if(current.id===p.id)setCurrent(next);notify('Project renamed');}} remove={(p)=>{setProjects(old=>old.filter(x=>x.id!==p.id));if(current.id===p.id){const next=blankProject();setCurrent(next);setSaved(true);}notify('Project deleted');}} /></Route>
          <Route path="/styles"><StylesPage selected={current.styleId} engine={current.engine} onChoose={(style)=>{patch({styleId:style.id,engine:style.engine});notify(`${style.name} selected`);setLocation('/');}} /></Route>
          <Route path="/"><Editor project={current} patch={patch} addScene={addScene} updateScene={updateScene} deleteScene={deleteScene} moveScene={moveScene} draftScenes={draftScenes} copyBrief={copyBrief} downloadBrief={downloadBrief} notify={notify}/></Route>
          <Route><NotFound back={()=>setLocation('/')}/></Route>
        </Switch>
      </div>
    </main>
    {toast&&<div className="toast"><Check size={16}/>{toast}</div>}
  </div>;
}

function Editor({project,patch,addScene,updateScene,deleteScene,moveScene,draftScenes,copyBrief,downloadBrief,notify}:{project:Project;patch:(u:Partial<Project>)=>void;addScene:()=>void;updateScene:(id:string,u:Partial<Scene>)=>void;deleteScene:(id:string)=>void;moveScene:(i:number,d:number)=>void;draftScenes:()=>void;copyBrief:()=>void;downloadBrief:()=>void;notify:(s:string)=>void}) {
  const [activeTab,setActiveTab]=useState<'idea'|'script'>('idea');
  const chosen=styles.find(s=>s.id===project.styleId)||styles[1];
  const total=project.scenes.reduce((a,s)=>a+s.seconds,0);
  const titleUpdate=(title:string)=>patch({title});
  return <div className="editor-page fade-in">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>PROJECT WORKSPACE <span className="eyebrow-id mono">SD—001</span></div><input className="project-title display" value={project.title} onChange={e=>titleUpdate(e.target.value)} aria-label="Project title"/><p className="page-subtitle">Turn the rough thought into a shootable story.</p></div><div className="heading-stamp"><span className="stamp-dot"/><span className="mono">BRIEF IN PROGRESS</span></div></div>
    <div className="editor-grid">
      <section className="left-column">
        <div className="panel idea-panel">
          <div className="section-head"><div className="section-index mono">01</div><div><h2>Start with the idea</h2><p>Give the story a point of view.</p></div><div className="tabs"><button className={activeTab==='idea'?'tab active':'tab'} onClick={()=>setActiveTab('idea')}>Idea</button><button className={activeTab==='script'?'tab active':'tab'} onClick={()=>setActiveTab('script')}>Script</button></div></div>
          {activeTab==='idea'?<div className="field-wrap"><label className="field-label" htmlFor="topic">What are you explaining?</label><textarea id="topic" className="idea-input" placeholder="For example: why your phone battery drains faster in the cold…" value={project.topic} onChange={e=>patch({topic:e.target.value})}/><div className="field-foot"><span>One clear sentence is plenty to begin.</span><span className="mono">{project.topic.length} / 500</span></div></div>:<div className="field-wrap"><label className="field-label" htmlFor="script">Your narration or working script</label><textarea id="script" className="idea-input script-input" placeholder="Paste a script, rough notes, or a voiceover draft…" value={project.script} onChange={e=>patch({script:e.target.value})}/><div className="field-foot"><span>Use this as source material for your storyboard draft.</span><span className="mono">{project.script.length} chars</span></div></div>}
          <div className="engine-select"><span className="field-label">Choose a workflow engine</span><div className="engine-options"><button className={`engine-choice ${project.engine==='model'?'selected':''}`} onClick={()=>patch({engine:'model',styleId:project.styleId.startsWith('A')?project.styleId:'A2'})}><span className="engine-symbol"><Sparkles size={17}/></span><span><b>Model Engine</b><small>Prompt-led visual direction</small></span>{project.engine==='model'&&<Check className="engine-check" size={16}/>}</button><button className={`engine-choice ${project.engine==='code'?'selected':''}`} onClick={()=>patch({engine:'code',styleId:project.styleId.startsWith('B')?project.styleId:'B1'})}><span className="engine-symbol code"><FileText size={17}/></span><span><b>Code Engine</b><small>Structured, reproducible scenes</small></span>{project.engine==='code'&&<Check className="engine-check" size={16}/>}</button></div></div>
          <div className="style-row"><div><span className="field-label">Visual style</span><button className="style-select" onClick={()=>window.location.assign(`${import.meta.env.BASE_URL}styles`)}><span className="style-swatch" style={{backgroundImage:chosen.image?`url("${imageUrl(chosen.image)}")`:undefined}}>{!chosen.image&&<span className="b6-art">B6</span>}</span><span className="style-select-text"><b>{chosen.name}</b><small>{project.engine==='model'?'Model Engine':'Code Engine'}</small></span><ChevronDown size={16}/></button></div><button className="text-link" onClick={()=>window.location.assign(`${import.meta.env.BASE_URL}styles`)}>Browse styles <ArrowRight size={13}/></button></div>
        </div>
        <div className="panel setup-panel">
          <div className="section-head compact"><div className="section-index mono">02</div><div><h2>Set the frame</h2><p>Production choices for this brief.</p></div></div>
          <div className="setup-grid"><div><span className="field-label">Aspect ratio</span><div className="ratio-options"><button className={`ratio-choice ${project.aspectRatio==='16:9'?'on':''}`} onClick={()=>patch({aspectRatio:'16:9'})}><span className="ratio-icon wide"/>Landscape <small>16:9</small></button><button className={`ratio-choice ${project.aspectRatio==='9:16'?'on':''}`} onClick={()=>patch({aspectRatio:'9:16'})}><span className="ratio-icon vertical"/>Portrait <small>9:16</small></button></div></div><div className="duration-setting"><label className="field-label" htmlFor="duration">Target duration</label><div className="duration-control"><input id="duration" type="number" min="15" max="600" step="15" value={project.durationSeconds} onChange={e=>patch({durationSeconds:Math.max(15,Number(e.target.value)||15)})}/><span>seconds</span></div><div className="duration-range"><input aria-label="Duration in seconds" type="range" min="15" max="180" step="5" value={Math.min(project.durationSeconds,180)} onChange={e=>patch({durationSeconds:Number(e.target.value)})}/><div><span>15s</span><span>3m+</span></div></div></div></div>
          <div className="audio-settings"><span className="field-label">Audio & accessibility</span><Toggle label="Voiceover" icon={<Mic2 size={16}/>} checked={project.voiceover} onChange={v=>patch({voiceover:v})}/><Toggle label="Subtitles" icon={<FileText size={16}/>} checked={project.subtitles} onChange={v=>patch({subtitles:v})}/><Toggle label="Sound effects" icon={<AudioLines size={16}/>} checked={project.soundEffects} onChange={v=>patch({soundEffects:v})}/></div>
        </div>
      </section>
      <section className="right-column">
        <div className="storyboard-title"><div><div className="eyebrow"><span className="eyebrow-line"/>STORYBOARD <span className="eyebrow-id mono">03</span></div><h2 className="display">Shape the sequence</h2><p>A practical plan for what viewers see and hear.</p></div><button className="draft-button" onClick={draftScenes}><WandSparkles size={15}/>Draft scenes</button></div>
        <div className="draft-note"><Sparkles size={14}/><span>Starter outline only — edit every beat. This does not generate or render video.</span></div>
        <div className="storyboard-meta"><span><b>{String(project.scenes.length).padStart(2,'0')}</b> scenes</span><span className="meta-sep">/</span><span><b>{total}</b>s planned</span><span className="meta-spacer"/><span className="format-pill">{project.aspectRatio}</span></div>
        <div className="scene-list">
          {project.scenes.length===0?<div className="empty-board"><div className="empty-sketch"><div className="sketch-sun"/><div className="sketch-horizon"/><div className="sketch-person"><i/><i/><i/><i/></div><div className="sketch-frame">FRAME 01</div></div><span className="mono empty-label">YOUR FIRST FRAME IS A THOUGHT</span><h3>Let’s put it on the board.</h3><p>Add your own scenes, or make a quick editable outline from your idea.</p><button className="btn btn-primary" onClick={draftScenes}><WandSparkles size={15}/>Draft a starting storyboard</button><button className="empty-add" onClick={addScene}><Plus size={15}/>Start with a blank scene instead</button></div>:project.scenes.map((scene,i)=><article className="scene-card" key={scene.id}><div className="scene-rail"><span className="scene-number mono">{String(i+1).padStart(2,'0')}</span><div className="scene-thumb" style={{backgroundImage:chosen.image?`linear-gradient(0deg,rgba(22,30,37,.35),transparent),url("${imageUrl(chosen.image)}")`:undefined}}>{!chosen.image&&<span className="b6-art">B6</span>}<span className="thumb-ratio">{project.aspectRatio}</span></div></div><div className="scene-body"><div className="scene-top"><input aria-label={`Scene ${i+1} title`} className="scene-name" value={scene.title} onChange={e=>updateScene(scene.id,{title:e.target.value})}/><div className="scene-actions"><div className="reorder"><button disabled={i===0} onClick={()=>moveScene(i,-1)} aria-label="Move scene up"><ArrowUp size={13}/></button><button disabled={i===project.scenes.length-1} onClick={()=>moveScene(i,1)} aria-label="Move scene down"><ArrowDown size={13}/></button></div><button className="icon-button delete-scene" onClick={()=>deleteScene(scene.id)} aria-label="Delete scene"><Trash2 size={15}/></button></div></div><label className="mini-label">NARRATION</label><textarea className="scene-text narration" value={scene.narration} onChange={e=>updateScene(scene.id,{narration:e.target.value})}/><label className="mini-label">VISUAL DIRECTION</label><textarea className="scene-text" value={scene.visualDirection} onChange={e=>updateScene(scene.id,{visualDirection:e.target.value})}/><div className="scene-foot"><span className="scene-cue"><span/>SHOT NOTE</span><label className="seconds-label">Duration <input type="number" min="1" max="90" value={scene.seconds} onChange={e=>updateScene(scene.id,{seconds:Math.max(1,Number(e.target.value)||1)})}/> sec</label></div></div></article>)}
        </div>
        {project.scenes.length>0&&<button className="add-scene" onClick={addScene}><Plus size={16}/>Add a scene</button>}
        <div className="brief-footer"><div><span className="mono">NEXT UP</span><strong>Review the brief before production.</strong><p>Export a text brief to take your plan into the next tool in your workflow.</p></div><div className="brief-actions"><button className="btn btn-outline" onClick={copyBrief}><Copy size={15}/>Copy brief</button><button className="btn btn-primary" onClick={downloadBrief}><Download size={15}/>Download .txt</button></div></div>
      </section>
    </div>
    <footer className="editor-footer"><span>Made for the part before the render.</span><span className="mono">LOCAL DRAFT · {chosen.name}</span></footer>
  </div>;
}

function Toggle({label,icon,checked,onChange}:{label:string;icon:React.ReactNode;checked:boolean;onChange:(v:boolean)=>void}) { return <button className={`toggle-row ${checked?'checked':''}`} onClick={()=>onChange(!checked)}><span className="toggle-icon">{icon}</span><span>{label}</span><span className="toggle-switch"><i/></span></button>; }

function ProjectsPage({projects,create,open,rename,remove}:{projects:Project[];create:()=>void;open:(p:Project)=>void;rename:(p:Project,t:string)=>void;remove:(p:Project)=>void}) {
  const [query,setQuery]=useState('');
  const list=useMemo(()=>projects.filter(p=>`${p.title} ${p.topic}`.toLowerCase().includes(query.toLowerCase())),[projects,query]);
  return <div className="library-page fade-in"><div className="library-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>YOUR WORKSPACE</div><h1 className="display">Projects<span className="heading-period">.</span></h1><p>Every idea gets a working copy. Saved in this browser, ready when you are.</p></div><button className="btn btn-primary create-top" onClick={create}><Plus size={16}/>New project</button></div><div className="library-toolbar"><span className="mono library-total">{projects.length.toString().padStart(2,'0')} PROJECT{projects.length===1?'':'S'}</span><label className="search-box"><Search size={16}/><input placeholder="Find a project…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button onClick={()=>setQuery('')} aria-label="Clear search"><X size={14}/></button>}</label></div>
  {list.length===0?<div className="library-empty"><div className="empty-stack"><Layers3 size={27}/><Plus size={17}/></div><h2>{projects.length?'Nothing matches that search.':'A blank page is a good place to start.'}</h2><p>{projects.length?'Try a different project title or topic.':'Create a project to turn your first idea into a scene-by-scene production brief.'}</p><button className="btn btn-primary" onClick={create}><Plus size={15}/>Create your first project</button></div>:<div className="project-list">{list.map((p,index)=>{const style=styles.find(s=>s.id===p.styleId)||styles[0];return <article className="project-card" key={p.id}><button className="project-image" onClick={()=>open(p)} style={{backgroundImage:style.image?`url("${imageUrl(style.image)}")`:undefined}}>{!style.image&&<span className="b6-art">B6</span>}<span className="project-index mono">{String(index+1).padStart(2,'0')}</span><span className="project-image-open"><ArrowRight size={16}/></span></button><div className="project-details"><div className="project-title-row"><button className="project-title-link display" onClick={()=>open(p)}>{p.title||'Untitled video'}</button><div className="project-quick"><button aria-label="Rename project" title="Rename project" onClick={()=>{const name=window.prompt('Rename project',p.title);if(name?.trim())rename(p,name.trim());}}><MoreHorizontal size={18}/></button></div></div><p className="project-topic">{p.topic||'No idea added yet'}</p><div className="project-tags"><span>{style.name}</span><i/><span>{p.aspectRatio}</span><i/><span>{p.scenes.length} scenes</span></div><div className="project-card-foot"><span className="mono">{new Date(p.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span><button className="open-project" onClick={()=>open(p)}>Open project <ArrowRight size={14}/></button><button className="project-delete" aria-label="Delete project" title="Delete project" onClick={()=>{if(window.confirm(`Delete “${p.title}”? This cannot be undone.`))remove(p);}}><Trash2 size={15}/></button></div></div></article>})}</div>}
  <div className="library-footnote"><span className="local-dot"/>All projects are stored locally in this browser. No account or upload required.</div></div>;
}

function StylesPage({selected,engine,onChoose}:{selected:string;engine:Engine;onChoose:(s:Style)=>void}) {
  const [filter,setFilter]=useState<'all'|Engine>('all'); const [query,setQuery]=useState('');
  const filtered=styles.filter(s=>(filter==='all'||s.engine===filter)&&`${s.name} ${s.desc}`.toLowerCase().includes(query.toLowerCase()));
  const groups: {key:Engine;title:string;sub:string;code:string}[]=[{key:'model',title:'Model Engine',sub:'Prompt-led visual direction',code:'A SERIES'},{key:'code',title:'Code Engine',sub:'Structured, reproducible scenes',code:'B SERIES'}];
  return <div className="library-page styles-page fade-in"><div className="library-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>THE LOOK OF THE STORY</div><h1 className="display">Style library<span className="heading-period">.</span></h1><p>Pick a visual language before you build the frames.</p></div><div className="current-style"><span className="current-label mono">CURRENT DIRECTION</span><b>{styles.find(s=>s.id===selected)?.name}</b><small>{engine==='model'?'Model Engine':'Code Engine'}</small></div></div><div className="library-toolbar"><div className="filter-tabs"><button className={filter==='all'?'filter-tab on':''} onClick={()=>setFilter('all')}>All styles <span>14</span></button><button className={filter==='model'?'filter-tab on':''} onClick={()=>setFilter('model')}>Model Engine <span>7</span></button><button className={filter==='code'?'filter-tab on':''} onClick={()=>setFilter('code')}>Code Engine <span>7</span></button></div><label className="search-box"><Search size={16}/><input placeholder="Search the library…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button onClick={()=>setQuery('')} aria-label="Clear search"><X size={14}/></button>}</label></div>{groups.map(group=>{const items=filtered.filter(s=>s.engine===group.key);if(!items.length)return null;return <section className="style-group" key={group.key}><div className="group-head"><div><span className="mono group-code">{group.code}</span><h2 className="display">{group.title}</h2><p>{group.sub}</p></div><span className="group-count mono">{String(items.length).padStart(2,'0')} STYLES</span></div><div className="style-grid">{items.map((style,i)=><button key={style.id} className={`style-card ${style.id===selected?'chosen':''}`} onClick={()=>onChoose(style)}><div className={`style-image ${!style.image?'no-art':''}`} style={style.image?{backgroundImage:`url("${imageUrl(style.image)}")`}:{}}>{!style.image&&<div className="b6-placeholder"><span className="mono">B6</span><i/><i/><i/></div>}<span className="style-number mono">{style.id}</span>{style.id===selected&&<span className="selected-mark"><Check size={14}/> SELECTED</span>}<span className="style-image-arrow"><ArrowRight size={16}/></span></div><div className="style-card-copy"><h3>{style.name}</h3><p>{style.desc}</p><span className="style-use">{style.id===selected?'CURRENT STYLE':'USE THIS STYLE'} <ArrowRight size={13}/></span></div><span className="style-card-num mono">0{i+1}</span></button>)}</div></section>})}{filtered.length===0&&<div className="library-empty compact-empty"><Search size={26}/><h2>No style found.</h2><p>Try a shorter search or switch the engine filter.</p><button className="text-link" onClick={()=>{setQuery('');setFilter('all')}}>Clear filters <X size={13}/></button></div>}<div className="styles-note"><Film size={17}/><span>Style references help set a direction for your brief. This workspace does not generate or render the selected style.</span></div></div>;
}

function NotFound({back}:{back:()=>void}) { return <div className="not-found"><span className="mono">404 · WRONG SET</span><h1 className="display">This scene isn’t in the script.</h1><p>Let’s get back to your production desk.</p><button className="btn btn-primary" onClick={back}><ArrowLeft size={15}/>Back to storyboard</button></div>; }

export default App;
