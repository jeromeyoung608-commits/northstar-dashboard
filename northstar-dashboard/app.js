
/* ══════════════════════════════════════════════════════════════
   Northstar · Infrastructure layer  (window.NS)
   M1 apiRequest · M2 UI states · M3 Route Guard · M4 Virtual list · M5 timing
   Pure native JS. Zero dependencies. No assumptions about the host page.
   ══════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ──────────────────────────────────────────────────────────────
   M5 · debounce / throttle
   debounce  : trailing edge, cancel() + flush() for full control
   throttle  : leading + trailing, at most one call per interval
   ────────────────────────────────────────────────────────────── */
function debounce(fn,delay){
  var wait=delay==null?500:delay,timer=null,ctx=null,args=null;
  function wrapped(){
    ctx=this;args=Array.prototype.slice.call(arguments);
    if(timer)clearTimeout(timer);
    timer=setTimeout(function(){timer=null;var c=ctx,a=args;ctx=null;args=null;fn.apply(c,a);},wait);
  }
  wrapped.cancel=function(){if(timer){clearTimeout(timer);timer=null;}ctx=null;args=null;};
  wrapped.flush=function(){if(!timer)return;clearTimeout(timer);timer=null;var c=ctx,a=args;ctx=null;args=null;fn.apply(c,a);};
  wrapped.pending=function(){return !!timer;};
  return wrapped;
}
function throttle(fn,interval){
  var gap=interval==null?200:interval,last=0,timer=null,ctx=null,args=null;
  function invoke(now){last=now;timer=null;var c=ctx,a=args;ctx=null;args=null;fn.apply(c,a);}
  return function(){
    ctx=this;args=Array.prototype.slice.call(arguments);
    var now=Date.now(),remain=gap-(now-last);
    if(remain<=0||remain>gap){if(timer){clearTimeout(timer);timer=null;}invoke(now);}
    else if(!timer){timer=setTimeout(function(){invoke(Date.now());},remain);}
  };
}

/* ──────────────────────────────────────────────────────────────
   M1 · Auth, typed errors, apiRequest
   ────────────────────────────────────────────────────────────── */
var TOKEN_KEY='token';
var Auth={
  key:TOKEN_KEY,
  get:function(){try{return localStorage.getItem(TOKEN_KEY);}catch(e){return null;}},
  set:function(v){try{localStorage.setItem(TOKEN_KEY,v);}catch(e){}return v;},
  clear:function(){try{localStorage.removeItem(TOKEN_KEY);}catch(e){}},
  isAuthed:function(){return !!this.get();},
  issue:function(label){var v='ns_demo_'+(label||'session')+'_'+Date.now().toString(36);return this.set(v);}
};

/* Every failure is a distinct, machine-readable error, not a string. */
function ApiError(kind,message,status,url,retryable,meta){
  Error.call(this,message);
  this.name='ApiError';
  this.kind=kind;
  this.message=message;
  this.status=status||0;
  this.url=url||'';
  this.retryable=retryable!==false;
  this.meta=meta||{};
  this.at=Date.now();
  if(Error.captureStackTrace)Error.captureStackTrace(this,ApiError);
}
ApiError.prototype=Object.create(Error.prototype);
ApiError.prototype.constructor=ApiError;
ApiError.prototype.toString=function(){return '['+this.kind+(this.status?'/'+this.status:'')+'] '+this.message;};
ApiError.prototype.userMessage=function(){return this.message;};

var HTTP_MESSAGES={
  400:'Bad request — the server could not understand this request.',
  401:'Session expired or credentials are missing. Please sign in again.',
  403:'Access denied — your role cannot read this resource.',
  404:'The requested resource no longer exists.',
  408:'The server timed out waiting for this request.',
  409:'Conflict — the resource changed while you were editing.',
  422:'Validation failed — please check the submitted fields.',
  429:'Too many requests. Please wait a moment and retry.',
  500:'Internal server error. The on-call data team has been notified.',
  502:'Bad gateway — an upstream service failed.',
  503:'Service temporarily unavailable. Please retry shortly.',
  504:'Gateway timeout. Please retry shortly.'
};

/**
 * apiRequest(url, options) -> Promise<{data,status,headers,url}>
 *   options.timeout   8000ms default, AbortController based
 *   options.method    GET | POST | ...
 *   options.headers   extra headers (Headers / plain object)
 *   options.body      object -> JSON, or string / FormData / Blob as-is
 *   options.token     overrides the localStorage token; null omits it
 *   options.signal    external AbortSignal, chained into the internal one
 *   options.credentials, options.cache, options.parse ('json'|'text'|'auto')
 * Throws ApiError with kind: TIMEOUT | NETWORK | ABORTED | UNAUTHORIZED |
 * FORBIDDEN | SERVER_ERROR | HTTP_ERROR | PARSE.
 */
async function apiRequest(url,options){
  options=options||{};
  const timeout=options.timeout==null?8000:options.timeout;
  const method=String(options.method||'GET').toUpperCase();
  const headers=new Headers(options.headers||{});
  const token=options.token===undefined?Auth.get():options.token;

  if(token)headers.set('Authorization','Bearer '+token);
  if(!headers.has('Accept'))headers.set('Accept','application/json');

  let body=options.body;
  const complex=body!==undefined&&body!==null&&typeof body!=='string'&&
    !(typeof FormData!=='undefined'&&body instanceof FormData)&&
    !(typeof Blob!=='undefined'&&body instanceof Blob)&&
    !(typeof URLSearchParams!=='undefined'&&body instanceof URLSearchParams);
  if(complex){body=JSON.stringify(body);if(!headers.has('Content-Type'))headers.set('Content-Type','application/json');}

  const ctrl=(typeof AbortController!=='undefined')?new AbortController():null;
  let timedOut=false,externalAbort=false;
  function onExternalAbort(){externalAbort=true;if(ctrl)ctrl.abort();}
  if(options.signal){
    if(options.signal.aborted){externalAbort=true;if(ctrl)ctrl.abort();}
    else options.signal.addEventListener('abort',onExternalAbort,{once:true});
  }
  const timer=setTimeout(function(){timedOut=true;if(ctrl)ctrl.abort();},timeout);

  const init={method:method,headers:headers,credentials:options.credentials||'same-origin',cache:options.cache||'no-store'};
  if(ctrl)init.signal=ctrl.signal;
  if(body!==undefined&&body!==null)init.body=body;

  let res;
  try{
    res=await fetch(url,init);
  }catch(err){
    if(timedOut)throw new ApiError('TIMEOUT',
      'Request timed out after '+timeout+'ms. Check your connection and retry.',0,url,true,{timeout:timeout});
    if(externalAbort||err.name==='AbortError')throw new ApiError('ABORTED','Request was cancelled.',0,url,false,{});
    throw new ApiError('NETWORK',
      'Network unreachable — you appear to be offline, or the server refused the connection.',0,url,true,
      {cause:String(err&&err.message||err)});
  }finally{
    clearTimeout(timer);
    if(options.signal&&options.signal.removeEventListener)options.signal.removeEventListener('abort',onExternalAbort);
  }

  if(!res.ok){
    let detail='';
    try{
      const probe=res.clone(),ct=probe.headers.get('content-type')||'';
      if(ct.indexOf('application/json')>=0){const j=await probe.json();detail=String(j.message||j.error||j.detail||'').slice(0,140);}
      else detail=String(await probe.text()||'').slice(0,140);
    }catch(e){/* a broken error body must never mask the real status */}
    const base=HTTP_MESSAGES[res.status]||('Request failed with HTTP '+res.status+'.');
    const msg=base+(detail?' ('+detail+')':'');
    const kind=res.status===401?'UNAUTHORIZED':res.status===403?'FORBIDDEN':
               res.status>=500?'SERVER_ERROR':'HTTP_ERROR';
    if(res.status===401)Auth.clear();
    throw new ApiError(kind,msg,res.status,url,
      res.status>=500||res.status===408||res.status===429,{statusText:res.statusText,detail:detail});
  }

  const parse=options.parse||'auto',ct=res.headers.get('content-type')||'';
  let data=null;
  try{
    if(res.status!==204&&method!=='HEAD')
      data=(parse==='text'||(parse==='auto'&&ct.indexOf('application/json')<0))?await res.text():await res.json();
  }catch(e){
    throw new ApiError('PARSE','Response body is not valid JSON.',res.status,url,true,{});
  }
  return {data:data,status:res.status,headers:res.headers,url:url};
}

/* ──────────────────────────────────────────────────────────────
   M2 · Loading skeleton + Error / Retry state layer
   The layer is an overlay: it never destroys existing DOM, so a failed
   refresh keeps the stale-but-useful content visible behind the error.
   ────────────────────────────────────────────────────────────── */
var LAYER='ns-state-layer';
function escText(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){
 return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function layer(container,create){
  var el=container?container.querySelector(':scope > .'+LAYER):null;
  if(!el&&create&&container){el=document.createElement('div');el.className=LAYER;container.appendChild(el);}
  return el;
}
function svgIcon(path){
  return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>';
}
function showLoading(container,label,variant){
  if(!container)return null;
  if(getComputedStyle(container).position==='static')container.style.position='relative';
  var el=layer(container,true);
  el.className=LAYER;
  var cells='';for(var i=0;i<4;i++)cells+='<div class="ns-bone h1"></div>';
  var rows=variant==='table'?'<div class="ns-bone h2"></div>':'<div class="ns-sk-row"><div class="ns-bone h2"></div><div class="ns-bone h2"></div></div>'+
    '<div class="ns-sk-row" style="margin-top:14px"><div class="ns-bone h3"></div><div class="ns-bone h3"></div></div>';
  el.innerHTML='<div class="ns-sk"><div class="ns-sk-top"><span class="spin"></span>'+
    '<span>'+escText(label||'Loading workspace data…')+'</span></div>'+
    '<div class="ns-sk-grid">'+cells+'</div>'+rows+'</div>';
  container.classList.add('ns-busy');
  return el;
}
function hideLoading(container){
  if(!container)return;
  var el=layer(container,false);
  if(el&&el.querySelector('.ns-sk'))el.remove();
  container.classList.remove('ns-busy');
}
function showError(container,errorMsg,retryCallback,opts){
  if(!container)return null;
  if(getComputedStyle(container).position==='static')container.style.position='relative';
  opts=opts||{};
  var el=layer(container,true);
  el.className=LAYER;
  var err=errorMsg instanceof ApiError?errorMsg:null;
  var msg=err?err.userMessage():String(errorMsg&&errorMsg.message||errorMsg||'Something went wrong.');
  var code=err?[err.kind,err.status||'—',err.url||'local'].join(' · '):'UNEXPECTED';
  el.innerHTML='<div class="ns-err-card"><div class="hd">'+
    svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5v.01"/>')+
    '<span>Could not load this data</span></div>'+
    '<p class="msg">'+escText(msg)+'</p>'+
    '<div class="code">'+escText(code)+'</div>'+
    '<div class="acts"><button class="ns-retry" data-ns-retry>'+
    svgIcon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>')+
    'Retry request</button>'+
    (opts.dismiss?'<button class="ns-dismiss" data-ns-dismiss>Dismiss</button>':'')+'</div></div>';
  container.classList.remove('ns-busy');
  var retry=el.querySelector('[data-ns-retry]');
  if(retry)retry.addEventListener('click',function(){
    hideError(container);
    if(typeof retryCallback==='function')retryCallback();
  });
  var dis=el.querySelector('[data-ns-dismiss]');
  if(dis)dis.addEventListener('click',function(){hideError(container);});
  return el;
}
function hideError(container){
  if(!container)return;
  var el=layer(container,false);
  if(el&&el.querySelector('.ns-err-card'))el.remove();
  container.classList.remove('ns-busy');
}
function clearState(container){hideLoading(container);hideError(container);}

/* ──────────────────────────────────────────────────────────────
   M3 · Route Guard (History API based, hash fallback for file://)
   ────────────────────────────────────────────────────────────── */
var PROTECTED=['dashboard','analytics','users','realtime','funnels','cohorts','reports','billing','settings','profile'];
var PUBLIC=['login'];
var Router={
  historyMode:false,
  onChange:null,
  _lastPath:null,
  _lastAt:0,
  PROTECTED:PROTECTED,
  PUBLIC:PUBLIC,
  init:function(opts){
    opts=opts||{};
    this.onChange=opts.onChange||function(){};
    var p=location.protocol;
    this.historyMode=(p==='http:'||p==='https:')&&!!(window.history&&history.pushState);
    var self=this;
    window.addEventListener('popstate',function(){self._fire();});
    window.addEventListener('hashchange',function(){self._fire();});
    /* another tab cleared the session -> re-guard immediately */
    window.addEventListener('storage',function(e){
      if(e.key===TOKEN_KEY&&!e.newValue)self._fire(true);
    });
    if(this.historyMode){
      var h=(location.hash||'').replace(/^#\/?/,'').split('/')[0];
      if(h==='login'||(h&&PROTECTED.indexOf(h)>=0)){
        try{history.replaceState({path:h},'','/'+h);}catch(e){}
      }
    }
    return this;
  },
  current:function(){
    if(this.historyMode){
      var seg=String(location.pathname||'').replace(/^\/+/,'').split('/')[0];
      if(seg&&!/\.(html?|php|aspx)$/i.test(seg)&&(PROTECTED.indexOf(seg)>=0||PUBLIC.indexOf(seg)>=0))return seg;
    }
    return (location.hash||'').replace(/^#\/?/,'').split('/')[0]||'dashboard';
  },
  /* Pure, synchronous, testable — the actual gate. */
  guard:function(path){
    var p=String(path||'dashboard').replace(/^[#\/]+/,'').split('/')[0]||'dashboard';
    if(PROTECTED.indexOf(p)>=0&&!Auth.isAuthed())
      return {allow:false,redirect:'login',reason:'NO_TOKEN',path:p};
    if(PUBLIC.indexOf(p)>=0&&Auth.isAuthed())
      return {allow:false,redirect:'dashboard',reason:'ALREADY_AUTHED',path:p};
    return {allow:true,redirect:null,reason:null,path:p};
  },
  navigate:function(path,opts){
    opts=opts||{};
    var v=this.guard(path),target=v.allow?v.path:v.redirect;
    var changed=this.current()!==target;
    if(this.historyMode){
      try{
        if(opts.replace||!changed)history.replaceState({path:target},'','/'+target);
        else history.pushState({path:target},'','/'+target);
      }catch(e){location.hash='#/'+target;}
    }else{
      var h='#/'+target;
      if(location.hash!==h){if(opts.replace)location.replace(h);else location.hash=h;}
    }
    if(!opts.silent)this._fire(true);
    return v;
  },
  _fire:function(force){
    var p=this.current(),v=this.guard(p),now=Date.now();
    if(!force&&p===this._lastPath&&now-this._lastAt<90)return;
    this._lastPath=p;this._lastAt=now;
    if(!v.allow){
      this.navigate(v.redirect,{replace:true,silent:true});
      this.onChange(v.redirect,{guarded:true,reason:v.reason,attempted:p});
      return;
    }
    this.onChange(p,{guarded:false});
  }
};

/* ──────────────────────────────────────────────────────────────
   M4 · Virtual table
   Only visible rows (plus overscan) are mounted in <tbody>.
   A <tbody> cannot legally contain a <div>, so total height is held by
   two transparent spacer <tr> elements — same effect, valid table markup.
   ────────────────────────────────────────────────────────────── */
function VirtualTable(scrollEl,tbody,opts){
  this.scrollEl=scrollEl;this.tbody=tbody;
  this.getRows=opts.getRows||function(){return [];};
  this.renderRow=opts.renderRow||function(){return '';};
  this.rowHeight=opts.rowHeight||46;
  this.overscan=opts.overscan==null?6:opts.overscan;
  this.cols=opts.cols||8;
  this.rows=[];
  this.lastStart=-1;this.lastEnd=-1;
  var self=this;
  /* M5 throttle is reused here too: at most one repaint per animation frame budget */
  this._onScroll=throttle(function(){self.paint();},16);
  scrollEl.addEventListener('scroll',this._onScroll,{passive:true});
  this.refresh();
}
VirtualTable.prototype.spacer=function(h){
  if(h<=0)return '';
  h=Math.round(h);
  return '<tr class="vspacer" aria-hidden="true" style="height:'+h+'px"><td colspan="'+this.cols+
    '" style="height:'+h+'px;padding:0;border:0;background:transparent;line-height:0"></td></tr>';
};
VirtualTable.prototype.paint=function(){
  var total=this.rows.length,rh=this.rowHeight;
  var st=this.scrollEl.scrollTop||0,vh=this.scrollEl.clientHeight||rh*10;
  var start=Math.max(0,Math.min(total,Math.floor(st/rh)-this.overscan));
  var end=Math.max(start,Math.min(total,Math.ceil((st+vh)/rh)+this.overscan));
  if(start===this.lastStart&&end===this.lastEnd)return;
  var html=this.spacer(start*rh);
  for(var i=start;i<end;i++)html+=this.renderRow(this.rows[i],i);
  html+=this.spacer((total-end)*rh);
  this.tbody.innerHTML=html;
  this.lastStart=start;this.lastEnd=end;
  this.visible=end-start;
};
VirtualTable.prototype.refresh=function(){
  this.rows=this.getRows()||[];
  this.lastStart=-1;this.lastEnd=-1;
  this.paint();
};
VirtualTable.prototype.scrollTo=function(index){
  this.scrollEl.scrollTop=Math.max(0,index*this.rowHeight);
  this.paint();
};
VirtualTable.prototype.destroy=function(){
  this.scrollEl.removeEventListener('scroll',this._onScroll);
  if(this.scrollEl.__vt===this)this.scrollEl.__vt=null;
};
VirtualTable.mount=function(scrollEl,tbody,opts){
  if(!scrollEl||!tbody)return null;
  if(scrollEl.__vt)scrollEl.__vt.destroy();
  var vt=new VirtualTable(scrollEl,tbody,opts);
  scrollEl.__vt=vt;
  return vt;
};

/* ── Export ─────────────────────────────────────────────────── */
window.NS={
  version:'1.0.0',
  debounce:debounce,throttle:throttle,
  Auth:Auth,ApiError:ApiError,HTTP_MESSAGES:HTTP_MESSAGES,apiRequest:apiRequest,
  showLoading:showLoading,hideLoading:hideLoading,
  showError:showError,hideError:hideError,clearState:clearState,
  Router:Router,guardRoute:function(p){return Router.guard(p);},
  VirtualTable:VirtualTable
};
})();



/* ============================================================
   Main application logic
   ============================================================ */


/* ══════════════════════════════════════════════════════════════
   1 · Data layer — deterministic mock backend (no network, no libs)
   ══════════════════════════════════════════════════════════════ */
'use strict';
const KEY='northstar.saas.v1';
const $=s=>document.querySelector(s), $$=s=>[].slice.call(document.querySelectorAll(s));
const ic=(n,c)=>'<svg class="ic '+(c||'')+'" aria-hidden="true"><use href="#i-'+n+'"></use></svg>';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=a=>a.reduce((x,y)=>x+y,0), avg=a=>a.length?sum(a)/a.length:0;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const noise=(i,k)=>{const x=Math.sin(i*12.9898+k*78.233+2026.1106)*43758.5453;return x-Math.floor(x);};

const NAV=[
 {group:'Workspace',items:[
   {id:'dashboard',label:'Dashboard',icon:'grid'},
   {id:'analytics',label:'Analytics',icon:'chart'},
   {id:'users',label:'Users',icon:'users',count:'28'}]},
 {group:'Insights',items:[
   {id:'realtime',label:'Realtime',icon:'activity',live:true},
   {id:'funnels',label:'Funnels',icon:'funnel'},
   {id:'cohorts',label:'Cohorts',icon:'layers'},
   {id:'reports',label:'Reports',icon:'file'}]},
 {group:'Manage',items:[
   {id:'billing',label:'Billing',icon:'card'},
   {id:'settings',label:'Settings',icon:'settings'}]}
];
const DIMS={
 revenue:{key:'revenue',label:'Revenue',unit:'money',color:'#22D3EE',base:9800,
   noun:'Gross revenue',desc:'Total recognized revenue across all plans, net of refunds and credits.',
   method:'Revenue = Σ (subscription MRR + usage overages + one-time expansion) − refunds. Recognized on cash basis for this workspace.',
   target:0.12,scale:[1,1,1,1],off:[0,0,0,0]},
 users:{key:'users',label:'Active Users',unit:'num',color:'#A78BFA',base:4200,
   noun:'Daily active users',desc:'Unique authenticated users with at least one meaningful product event in the period.',
   method:'DAU counts distinct user_id with ≥1 qualifying event. Bot traffic and internal staff accounts are excluded via a server-side filter.',
   target:0.08,scale:[.74,1.34,1.14,1.05],off:[-4.6,5.2,1.8,-1.1]},
 conversion:{key:'conversion',label:'Conversion Rate',unit:'pct',color:'#34D399',base:4.6,
   noun:'Visit-to-subscription conversion',desc:'Share of qualified sessions that complete a paid subscription within the attribution window.',
   method:'Conversions ÷ qualified sessions × 100. Attribution = last non-direct touch, 7-day window. Sessions from internal IPs are excluded.',
   target:0.15,scale:[.88,.84,1.28,.79],off:[3.1,-2.4,4.7,-3.6]}
};
const RANGES={'7D':{n:7,step:'day',label:'Last 7 days'},'30D':{n:30,step:'day',label:'Last 30 days'},
  '90D':{n:90,step:'day',label:'Last 90 days'},'12M':{n:12,step:'month',label:'Last 12 months'}};
const KPI_DEF=[
 {id:'rev',label:'Total Revenue',kind:'money',v:284392,d:12.8,goodUp:true,icon:'wallet'},
 {id:'usr',label:'Active Users',kind:'num',v:18420,d:8.4,goodUp:true,icon:'users'},
 {id:'ses',label:'Avg. Session',kind:'dur',v:264,d:5.1,goodUp:true,icon:'clock'},
 {id:'bnc',label:'Bounce Rate',kind:'pct1',v:38.2,d:-2.4,goodUp:false,icon:'mouse'}
];
const GRADS=[['#3B82F6','#22D3EE'],['#8B5CF6','#C084FC'],['#10B981','#6EE7B7'],['#F59E0B','#FCD34D'],
 ['#F43F5E','#FB7185'],['#06B6D4','#67E8F9'],['#6366F1','#818CF8'],['#EC4899','#F472B6']];
const ACCENTS=[{id:'blue',c1:'#3B82F6',c2:'#22D3EE',name:'Azure'},{id:'violet',c1:'#8B5CF6',c2:'#C084FC',name:'Violet'},
 {id:'emerald',c1:'#10B981',c2:'#6EE7B7',name:'Emerald'},{id:'amber',c1:'#F59E0B',c2:'#FCD34D',name:'Amber'}];
const STATUSES=['Active','Pending','Churned'];
const PLANS=['Free','Starter','Growth','Scale','Enterprise'];
const ROLES=['Owner','Admin','Analyst','Editor','Viewer'];
const COUNTRIES=['United States','United Kingdom','Germany','Canada','Netherlands','Australia','Singapore','France','Japan','Sweden','Brazil','India'];
const DOMAINS=['lumenlabs.io','northwind.co','pixelcraft.dev','orbitalsystems.io','brightpath.io','quorix.com',
 'heliospace.io','meridianlabs.co','vexa.io','stonecrest.co','aurelia.dev','kestrelworks.io','solsticeapp.co','driftwood.io'];
const PEOPLE=['Olivia Bennett','Marcus Chen','Sofia Alvarez','Ethan Wright','Priya Nair','Noah Fischer','Ava Thompson',
 'Liam Okafor','Isabella Rossi','Kenji Watanabe','Maya Patel','Lucas Moreau','Grace Kim','Felix Bauer',
 'Chloe Dubois','Adrian Silva','Nina Kowalski','Theo Laurent','Zoe Harrison','Omar Haddad','Elena Petrova',
 'Jasper Nguyen','Ruby Callahan','Milo Andersen','Clara Mendes','Dev Kapoor','Hannah Berg','Isaac Foster'];

function seedUsers(){
 return PEOPLE.map((name,i)=>{
  const first=name.split(' ')[0],last=name.split(' ')[1];
  const r=noise(i,3),r2=noise(i,7),r3=noise(i,11),r4=noise(i,17),r5=noise(i,23);
  const status=r<.62?'Active':r<.84?'Pending':'Churned';
  return {id:'U-'+(1001+i),name:name,email:(first+'.'+last).toLowerCase()+'@'+DOMAINS[i%DOMAINS.length],
   initials:first[0]+last[0],g:i%GRADS.length,status:status,
   plan:PLANS[Math.floor(r2*PLANS.length)],role:ROLES[Math.floor(r3*ROLES.length)],
   mrr:Math.round(29+Math.pow(r4,1.7)*870),country:COUNTRIES[Math.floor(r5*COUNTRIES.length)],
   last:status==='Churned'?Math.round(2200+r*9000):Math.round(r5*r5*2600),
   sessions:Math.round(12+r2*420),joined:new Date(Date.now()-Math.round(30+r3*900)*86400000).toISOString().slice(0,10),
   bars:Array.from({length:14},(_,j)=>Math.round(4+noise(i*17+j,29)*16))};
 });
}
function seedEvents(){
 const kinds=[['zap','New subscription','Growth plan · Lumenlabs','info'],
  ['user-plus','Signup completed','Organic search · United States','good'],
  ['card','Payment received','$249.00 · Meridianlabs','good'],
  ['alert','Anomaly detected','Bounce rate +9.4% on /pricing','bad'],
  ['activity','Session milestone','10k concurrent events','info'],
  ['star','Goal reached','Q4 activation target','good']];
 return Array.from({length:9},(_,i)=>{const k=kinds[i%kinds.length];return {icon:k[0],title:k[1],sub:k[2],kind:k[3],ago:i*3+(i%3)*2};});
}
function seedState(){
 return {
  dim:'revenue',range:'30D',gran:'Day',compare:true,collapsed:false,accent:'blue',
  users:seedUsers(),events:seedEvents(),
  table:{q:'',status:'All',sort:'mrr',dir:'desc',page:1,per:8,sel:[],open:null},
  settings:{workspace:'Northstar Labs',timezone:'(UTC−08:00) Pacific Time',currency:'USD — US Dollar',
   language:'English (US)',refresh:'Every 5 minutes',apiKey:'ns_live_8K2mQ7vX4pL9rT1zY6cW3',
   toggles:{email:true,weekly:true,anomaly:true,product:false,beta:true}},
  notifications:[
   {icon:'alert',title:'Anomaly on /pricing',sub:'Bounce rate +9.4% vs. 7-day baseline',ago:'12m',read:false,kind:'bad'},
   {icon:'star',title:'Q4 activation goal reached',sub:'112% of target, 6 days early',ago:'1h',read:false,kind:'good'},
   {icon:'file',title:'Weekly report is ready',sub:'Nov 1 – Nov 6 · 18 metrics',ago:'3h',read:false,kind:'info'},
   {icon:'users',title:'3 new teammates joined',sub:'Workspace access pending review',ago:'Yesterday',read:true,kind:'info'}],
  reports:[
   {name:'Weekly executive summary',desc:'Revenue, activation, retention and anomalies',cadence:'Every Monday · 08:00',icon:'file',kind:'good'},
   {name:'Cohort retention deep-dive',desc:'8-week retention by acquisition channel',cadence:'Monthly · 1st',icon:'layers',kind:'info'},
   {name:'Revenue forecast & variance',desc:'Actuals vs. plan with confidence interval',cadence:'Quarterly',icon:'chart',kind:'info'},
   {name:'Churn risk watchlist',desc:'Accounts with declining engagement signals',cadence:'On-demand',icon:'alert',kind:'bad'}]
 };
}
let S;
function load(){try{const raw=localStorage.getItem(KEY);if(raw){const p=JSON.parse(raw);const d=seedState();return Object.assign(d,p,{settings:Object.assign(d.settings,p.settings||{}),table:Object.assign(d.table,p.table||{})});}}catch(e){}return seedState();}
S=load();
document.documentElement.dataset.accent=S.accent;

/* ── Formatting ─────────────────────────────────────────────── */
function money(v,compact){if(!isFinite(v))return '$0';const a=Math.abs(v);
 if(compact&&a>=1e6)return '$'+(v/1e6).toFixed(2)+'M';if(compact&&a>=1e4)return '$'+(v/1e3).toFixed(1)+'k';
 return '$'+Math.round(v).toLocaleString('en-US');}
function num(v,compact){if(!isFinite(v))return '0';const a=Math.abs(v);
 if(compact&&a>=1e6)return (v/1e6).toFixed(2)+'M';if(compact&&a>=1e4)return (v/1e3).toFixed(1)+'k';
 return Math.round(v).toLocaleString('en-US');}
function pct(v,d){return (isFinite(v)?v:0).toFixed(d==null?1:d)+'%';}
function dur(sec){const m=Math.floor(sec/60),s=Math.round(sec%60);return m+'m '+String(s).padStart(2,'0')+'s';}
function fmt(kind,v,compact){
 if(kind==='money')return money(v,compact);if(kind==='num')return num(v,compact);
 if(kind==='pct')return pct(v,2);if(kind==='pct1')return pct(v,1);if(kind==='dur')return dur(v);return String(v);}
function pctDelta(a,b){return b?((a-b)/b)*100:0;}
function deltaHtml(v,goodUp,opts){
 const good=goodUp?v>=0:v<=0;const o=opts||{};
 return '<span class="delta '+(good?'good':'bad')+'">'+ic(v>=0?'arrow-ur':'arrow-dr')+(v>=0?'+':'')+v.toFixed(1)+'%</span>'+
   (o.suffix?'<span class="muted" style="font-size:10.5px">'+o.suffix+'</span>':'');
}
function timeAgo(mins){
 if(mins<1)return 'Just now';if(mins<60)return Math.round(mins)+'m ago';if(mins<1440)return Math.round(mins/60)+'h ago';
 return Math.round(mins/1440)+'d ago';}
const AVATAR_PICS=['images/avatar-dana.jpg','images/avatar-marcus.jpg','images/avatar-priya.jpg',
 'images/avatar-owen.jpg','images/avatar-ines.jpg','images/avatar-theo.jpg',
 'images/avatar-rosa.jpg','images/avatar-hana.jpg','images/avatar-kenji.jpg',
 'images/avatar-june.jpg','images/avatar-milo.jpg'];
function avatar(u,size){const g=GRADS[u.g%GRADS.length];
 const pic=AVATAR_PICS[(u.g||0)%AVATAR_PICS.length];
 return '<span class="avatar '+(size||'')+'" style="background:linear-gradient(135deg,'+g[0]+','+g[1]+')">'+
   '<img src="'+pic+'" alt="" onerror="this.style.display=\'none\'"></span>';}
function toast(title,sub,kind){
 const el=document.createElement('div');el.className='toast '+(kind||'ok');
 el.innerHTML=ic(kind==='err'?'alert':kind==='inf'?'info':'check-circle')+'<div><b>'+esc(title)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</div>';
 $('#toasts').appendChild(el);setTimeout(()=>{el.style.transition='opacity .3s,transform .3s';el.style.opacity=0;el.style.transform='translateX(20px)';setTimeout(()=>el.remove(),320);},3200);}
function openModal(title,body,footer,wide){
 $('#modal').className='modal'+(wide?' wide':'');
 $('#modal').innerHTML='<div class="modal-h">'+ic('sliders')+'<h3>'+esc(title)+'</h3><button class="icon-btn" data-act="close-modal">'+ic('x')+'</button></div>'+
  '<div class="modal-b">'+body+'</div>'+(footer?'<div class="modal-f">'+footer+'</div>':'');
 $('#overlay').classList.add('show');}
function closeModal(){$('#overlay').classList.remove('show');}
function confirmBox(title,msg,okLabel,onOk){
 window.__confirm=onOk;
 openModal(title,'<p style="font-size:12.5px;color:var(--txt-2);line-height:1.7">'+msg+'</p>',
  '<button class="btn gho" data-act="close-modal">Cancel</button><button class="btn danger" data-act="confirm-yes">'+ic('trash')+esc(okLabel||'Confirm')+'</button>');}
function downloadCSV(filename,rows){
 const csv=rows.map(r=>r.map(c=>'"'+String(c==null?'':c).replace(/"/g,'""')+'"').join(',')).join('\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),800);
 toast('Export ready',filename+' downloaded','ok');}

/* ── Number roll animation ─────────────────────────────────── */
function animateNum(el,to,fmtFn,dur){
 if(!el)return;const from=parseFloat(el.getAttribute('data-v')||'0');el.setAttribute('data-v',to);
 if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){el.textContent=fmtFn(to);return;}
 const t0=performance.now(),D=dur||820;
 if(el.__raf)cancelAnimationFrame(el.__raf);
 function step(t){const k=clamp((t-t0)/D,0,1),e=1-Math.pow(1-k,3);el.textContent=fmtFn(from+(to-from)*e);
  if(k<1)el.__raf=requestAnimationFrame(step);}el.__raf=requestAnimationFrame(step);}
function rollKPIs(){
 const d=DIMS[S.dim];
 $$('.kpi .num').forEach(el=>{
  const id=el.closest('.kpi').getAttribute('data-kpi'),def=KPI_DEF.find(x=>x.id===id);if(!def)return;
  const idx=KPI_DEF.indexOf(def),v=def.v*d.scale[idx];
  animateNum(el,v,x=>fmt(def.kind,x,false));
 });}

/* ── Series engine ─────────────────────────────────────────── */
function dateLabels(n,step){
 const out=[],now=new Date();
 for(let i=0;i<n;i++){
  const d=new Date(now);d.setHours(12,0,0,0);
  if(step==='month')d.setMonth(d.getMonth()-(n-1-i));else d.setDate(d.getDate()-(n-1-i));
  out.push(step==='month'?d.toLocaleDateString('en-US',{month:'short'}):
    d.toLocaleDateString('en-US',{month:'short',day:'numeric'}));
 }return out;}
function series(dimKey,rangeKey){
 const d=DIMS[dimKey]||DIMS.revenue,cfg=RANGES[rangeKey]||RANGES['30D'],n=cfg.n,seed=dimKey==='revenue'?1:dimKey==='users'?2:3;
 const cur=[],prev=[];
 for(let i=0;i<n;i++){
  const t=i/Math.max(1,n-1),season=Math.sin(i*(cfg.step==='month'?.55:.42)+seed)*.075,
   wave=Math.cos(i*.19+seed)*.045,nz=(noise(i,seed)-.5)*.085,growth=.70+.44*t;
  cur.push(d.base*growth*(1+season+wave+nz));
  prev.push(d.base*.84*(.70+.35*t)*(1+season*.8+wave*.8+(noise(i,seed+9)-.5)*.07));
 }
 // a deliberate, explainable anomaly so the product has something to surface
 if(n>=12){const k=Math.floor(n*.62);cur[k]*=1.24;cur[Math.floor(n*.28)]*=.87;}
 return {labels:dateLabels(n,cfg.step),cur:cur,prev:prev,dim:d,range:cfg,n:n};}
function heroValue(sr){
 const d=sr.dim;
 if(d.unit==='money')return {v:sum(sr.cur),kind:'money',label:'Total '+d.label+' · '+sr.range.label,sub:'Recognized in period'};
 return {v:avg(sr.cur),kind:d.unit,label:d.unit==='pct'?'Average '+d.label:'Average daily '+d.label,sub:'Mean across '+sr.n+' data points'};}
function kpiValues(){const d=DIMS[S.dim];return KPI_DEF.map((k,i)=>{
 const v=k.v*d.scale[i],dv=k.d+d.off[i];return Object.assign({},k,{v:v,d:dv,good:k.goodUp?dv>=0:dv<=0});});}
function channelData(dimKey){
 const base=['Organic Search','Direct','Paid Social','Referral','Email','Partnerships'];
 const s=series(dimKey,S.range),total=sum(s.cur);
 return base.map((nm,i)=>{const w=[.29,.23,.17,.13,.11,.07][i],v=total*w*(1+(noise(i,dimKey.length*3)-.5)*.28),
  dl=(noise(i+40,6)-.42)*24;return {name:nm,value:v,delta:dl,color:GRADS[i%GRADS.length][0]};});}
function funnelData(){
 const steps=['Visitors','Signed up','Activated','Subscribed','Retained 30d'],base=128400;
 const rates=[1,.424,.286,.118,.091],vals=rates.map(r=>Math.round(base*r));
 return steps.map((s,i)=>({name:s,v:vals[i],pct:rates[i]*100,drop:i?((vals[i-1]-vals[i])/vals[i-1]*100):0}));
}
function cohortData(){
 const out=[];for(let r=0;r<8;r++){const row=[];for(let c=0;c<8;c++){
  let v;if(c===0)v=100;else if(c>r)v=null;else v=clamp(100*Math.pow(.78,c)+((noise(r*9+c,13)-.5)*9)-r*.65,8,100);
  row.push(v);}out.push(row);}return out;}
function insightsFor(sr){
 const out=[],cur=sr.cur,prev=sr.prev,d=sr.dim;
 const growth=pctDelta(sum(cur),sum(prev)),peak=cur.indexOf(Math.max.apply(null,cur)),low=cur.indexOf(Math.min.apply(null,cur));
 const ch=channelData(S.dim).slice().sort((a,b)=>b.delta-a.delta),best=ch[0],worst=ch[ch.length-1];
 const roll=avg(cur),dev=(cur[peak]-roll)/roll*100;
 out.push({kind:growth>=0?'pos':'neg',icon:growth>=0?'arrow-ur':'arrow-dr',title:growth>=0?'Above previous period':'Below previous period',
  text:d.label+' is '+(growth>=0?'up':'down')+' <b>'+Math.abs(growth).toFixed(1)+'%</b> versus the comparable '+sr.range.label.toLowerCase()+'. '+
   'Current period total <b>'+fmt(d.unit,sum(cur),true)+'</b> against <b>'+fmt(d.unit,sum(prev),true)+'</b> previously.',
  meta:'Δ = (current − comparison) ÷ comparison × 100'});
 out.push({kind:dev>15?'wrn':'nfo',icon:'zap',title:'Peak on '+sr.labels[peak],
  text:'Highest observed value was <b>'+fmt(d.unit,cur[peak],true)+'</b>, <b>'+dev.toFixed(1)+'%</b> above the period mean. '+
   (dev>15?'This exceeds the ±15% anomaly threshold and is flagged for review.':'This sits within the expected variance band.'),
  meta:'z-score ≈ '+(dev/9).toFixed(2)+' · threshold ±15%'});
 out.push({kind:best.delta>=0?'pos':'neg',icon:'target',title:'Best channel: '+best.name,
  text:'<b>'+best.name+'</b> is contributing '+fmt(d.unit,best.value,true)+' with a <b>'+(best.delta>=0?'+':'')+best.delta.toFixed(1)+'%</b> shift in share. '+
   'Weakest momentum is <b>'+worst.name+'</b> at '+(worst.delta>=0?'+':'')+worst.delta.toFixed(1)+'%.',
  meta:'Share of total by attributed channel'});
 const bnc=kpiValues()[3];
 out.push({kind:bnc.good?'pos':'neg',icon:bnc.good?'check-circle':'alert',title:'Bounce rate '+(bnc.good?'improving':'needs attention'),
  text:'Bounce rate is <b>'+pct(bnc.v,1)+'</b>, '+(bnc.d>=0?'up':'down')+' '+Math.abs(bnc.d).toFixed(1)+' pts. '+
   (bnc.good?'Sessions are getting longer on average.':'Investigate landing page load time and the /pricing variant.'),
  meta:'Correlated with Avg. Session '+dur(kpiValues()[2].v)});
 out.push({kind:'nfo',icon:'sparkle',title:'Low point on '+sr.labels[low],
  text:'Trough of <b>'+fmt(d.unit,cur[low],true)+'</b>. Weekday seasonality explains roughly '+(38+Math.round(noise(low,4)*22))+'% of the variation in this window.',
  meta:'Seasonal decomposition · moving average n=7'});
 return out;}
/* ══════════════════════════════════════════════════════════════
   2 · Pure-SVG chart engine (no canvas, no libraries)
   ══════════════════════════════════════════════════════════════ */
let CHARTS=[];
function accentColors(){return ACCENTS.find(a=>a.id===S.accent)||ACCENTS[0];}
function chartSlot(id,opts){CHARTS.push({id:id,opts:opts||{}});return '<div class="chart" id="'+id+'"></div>';}
function smoothPath(pts){
 if(pts.length<2)return '';let d='M'+pts[0].x.toFixed(2)+','+pts[0].y.toFixed(2);
 for(let i=0;i<pts.length-1;i++){
  const p0=pts[i-1]||pts[i],p1=pts[i],p2=pts[i+1],p3=pts[i+2]||p2;
  const c1x=p1.x+(p2.x-p0.x)/6,c1y=p1.y+(p2.y-p0.y)/6,
        c2x=p2.x-(p3.x-p1.x)/6,c2y=p2.y-(p3.y-p1.y)/6;
  d+=' C'+c1x.toFixed(2)+','+c1y.toFixed(2)+' '+c2x.toFixed(2)+','+c2y.toFixed(2)+' '+p2.x.toFixed(2)+','+p2.y.toFixed(2);
 }return d;}
function lineChart(id,opts){
 const host=document.getElementById(id);if(!host)return;
 const o=opts||{},sr=o.series||series(S.dim,S.range),dim=sr.dim;
 /* Height follows the CSS box so the SVG never overflows a mobile viewport. */
 const W=Math.max(300,host.clientWidth||760),H=Math.max(200,host.clientHeight||o.height||292);
 const pad={l:56,r:14,t:14,b:28},pw=W-pad.l-pad.r,ph=H-pad.t-pad.b;
 const all=sr.cur.concat(o.compare!==false&&S.compare?sr.prev:[]);
 const mx=Math.max.apply(null,all),mn=Math.min.apply(null,all),span=mx-mn||Math.abs(mx)||1;
 const hi=mx+span*.20,lo=Math.max(0,mn-span*.22),rng=hi-lo||1;
 const X=i=>pad.l+(sr.n===1?pw/2:i*pw/(sr.n-1)),Y=v=>pad.t+ph-((v-lo)/rng)*ph;
 const A=accentColors(),uid='g'+id.replace(/[^a-z0-9]/gi,'');
 const pts=sr.cur.map((v,i)=>({x:X(i),y:Y(v)})),d=smoothPath(pts),
   area=d+' L'+X(sr.n-1).toFixed(2)+','+(pad.t+ph)+' L'+X(0).toFixed(2)+','+(pad.t+ph)+' Z';
 const prevD=smoothPath(sr.prev.map((v,i)=>({x:X(i),y:Y(v)})));
 let grid='',labels='';
 for(let k=0;k<=4;k++){
  const y=pad.t+ph*k/4,v=hi-(rng*k/4);
  grid+='<line class="grid-l" x1="'+pad.l+'" y1="'+y.toFixed(1)+'" x2="'+(W-pad.r)+'" y2="'+y.toFixed(1)+'"/>';
  labels+='<text class="axis-t" x="'+(pad.l-9)+'" y="'+(y+3.5).toFixed(1)+'" text-anchor="end">'+fmt(dim.unit,v,true)+'</text>';
 }
 const step=Math.max(1,Math.ceil(sr.n/7));
 for(let i=0;i<sr.n;i+=step){
  const x=X(i);grid+='<line class="grid-v" x1="'+x.toFixed(1)+'" y1="'+pad.t+'" x2="'+x.toFixed(1)+'" y2="'+(pad.t+ph)+'"/>';
  labels+='<text class="axis-t" x="'+x.toFixed(1)+'" y="'+(H-7)+'" text-anchor="middle">'+sr.labels[i]+'</text>';
 }
 const lastX=X(sr.n-1),lastY=Y(sr.cur[sr.n-1]);
 const svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'" role="img" aria-label="'+esc(dim.label)+' trend chart">'+
  '<defs>'+
   '<linearGradient id="'+uid+'l" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="'+A.c1+'"/><stop offset="100%" stop-color="'+A.c2+'"/></linearGradient>'+
   '<linearGradient id="'+uid+'a" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+A.c2+'" stop-opacity=".38"/><stop offset="100%" stop-color="'+A.c2+'" stop-opacity="0"/></linearGradient>'+
   '<clipPath id="'+uid+'c"><rect id="'+uid+'r" x="0" y="0" width="0" height="'+H+'"/></clipPath>'+
  '</defs>'+grid+
  '<g clip-path="url(#'+uid+'c)"><path d="'+area+'" fill="url(#'+uid+'a)"/></g>'+
  (S.compare?'<path class="ln-prev" d="'+prevD+'"/>':'')+
  '<path class="ln-main" d="'+d+'" stroke="url(#'+uid+'l)"/>'+
  '<line class="cross" id="'+uid+'x" x1="0" y1="'+pad.t+'" x2="0" y2="'+(pad.t+ph)+'" style="opacity:0"/>'+
  '<circle class="ln-dot" id="'+uid+'p" r="5" cx="0" cy="0" stroke="'+A.c2+'" style="opacity:0"/>'+
  '<circle cx="'+lastX.toFixed(2)+'" cy="'+lastY.toFixed(2)+'" r="4.5" fill="'+A.c2+'" opacity=".95"/>'+
  '<circle cx="'+lastX.toFixed(2)+'" cy="'+lastY.toFixed(2)+'" r="9" fill="'+A.c2+'" opacity=".15"/>'+
  labels+'</svg><div class="tip" id="'+uid+'t"></div>';
 host.innerHTML=svg;
 // stroke draw-on animation: dasharray / dashoffset driven from real path length
 const line=host.querySelector('.ln-main'),clip=document.getElementById(uid+'r'),tip=document.getElementById(uid+'t'),
   cross=document.getElementById(uid+'x'),dot=document.getElementById(uid+'p');
 if(line){
  const L=line.getTotalLength();line.style.strokeDasharray=L;line.style.strokeDashoffset=L;
  requestAnimationFrame(()=>{line.style.transition='stroke-dashoffset 1.15s cubic-bezier(.22,.61,.36,1)';line.style.strokeDashoffset='0';
   if(clip)clip.style.transition='width 1.15s cubic-bezier(.22,.61,.36,1)',clip.setAttribute('width',W);});
 }
 host.onmousemove=function(e){
  const r=host.getBoundingClientRect(),x=e.clientX-r.left,idx=clamp(Math.round((x-pad.l)/pw*(sr.n-1)),0,sr.n-1);
  const px=X(idx),py=Y(sr.cur[idx]);
  if(cross){cross.setAttribute('x1',px);cross.setAttribute('x2',px);cross.style.opacity=1;}
  if(dot){dot.setAttribute('cx',px);dot.setAttribute('cy',py);dot.style.opacity=1;}
  if(tip){const pv=sr.prev[idx],dl=pctDelta(sr.cur[idx],pv);
   tip.innerHTML='<div class="d">'+esc(sr.labels[idx])+'</div><div class="v">'+fmt(dim.unit,sr.cur[idx],false)+'</div>'+
    '<div class="p">vs previous <i class="'+(dl>=0?'up':'down')+'">'+(dl>=0?'+':'')+dl.toFixed(1)+'%</i></div>';
   tip.style.left=clamp(px,72,r.width-72)+'px';tip.style.top=Math.max(58,py)+'px';tip.classList.add('show');}
 };
 host.onmouseleave=function(){if(tip)tip.classList.remove('show');if(cross)cross.style.opacity=0;if(dot)dot.style.opacity=0;};
}
function sparkline(vals,color,w,h){
 w=w||88;h=h||34;const A=accentColors(),c=color||A.c2,mx=Math.max.apply(null,vals),mn=Math.min.apply(null,vals),rg=mx-mn||1;
 const pts=vals.map((v,i)=>({x:2+i*(w-4)/(vals.length-1),y:h-3-((v-mn)/rg)*(h-8)}));
 const d=smoothPath(pts),area=d+' L'+(w-2)+','+h+' L2,'+h+' Z',uid='sp'+Math.random().toString(36).slice(2,8);
 return '<svg class="spark" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" aria-hidden="true">'+
  '<defs><linearGradient id="'+uid+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+c+'" stop-opacity=".30"/><stop offset="100%" stop-color="'+c+'" stop-opacity="0"/></linearGradient></defs>'+
  '<path d="'+area+'" fill="url(#'+uid+')"/><path d="'+d+'" fill="none" stroke="'+c+'" stroke-width="1.8" stroke-linecap="round"/></svg>';
}
function donutHTML(items,id){
 const R=58,C=2*Math.PI*R,total=sum(items.map(x=>x.value))||1;let acc=0,segs='';
 items.forEach((it,i)=>{const len=it.value/total*C;
  segs+='<circle class="dseg" data-dash="'+len.toFixed(2)+' '+C.toFixed(2)+'" data-off="'+(-acc).toFixed(2)+'" cx="73" cy="73" r="'+R+'" stroke="'+it.color+'" stroke-dasharray="0 '+C.toFixed(2)+'" stroke-dashoffset="'+(-acc).toFixed(2)+'"/>';
  acc+=len;});
 return '<div class="donut-box"><svg class="donut" viewBox="0 0 146 146" width="146" height="146" aria-hidden="true">'+
  '<circle class="ring-bg" cx="73" cy="73" r="'+R+'"/>'+segs+'</svg>'+
  '<div class="donut-mid"><b>'+num(total,true)+'</b><span>Total</span></div></div>';
}
function barsHTML(rows,opts){
 const o=opts||{},max=Math.max.apply(null,rows.map(r=>r.value))||1;
 return rows.map((r,i)=>'<div class="barrow"><span class="nm">'+esc(r.name)+'</span>'+
  '<span class="track"><i class="'+(o.alt?'alt':o.green?'gr':'')+'" data-w="'+clamp(r.value/max*100,3,100).toFixed(1)+'" style="width:0%"></i></span>'+
  '<span class="val">'+num(r.value,true)+(r.delta!=null?'<em class="'+(r.delta>=0?'up':'down')+'">'+(r.delta>=0?'+':'')+r.delta.toFixed(1)+'%</em>':'')+'</span></div>').join('');
}
function funnelHTML(steps){
 return '<div class="funnel">'+steps.map((s,i)=>'<div class="fstep">'+
  '<span class="fill" data-w="'+clamp(s.pct,8,100).toFixed(1)+'" style="width:0%"></span>'+
  '<span class="nm">'+ic(i===0?'globe':i===1?'user-plus':i===2?'zap':i===3?'card':'star','s')+' &nbsp;'+esc(s.name)+'</span>'+
  '<span class="v">'+num(s.v)+'</span>'+
  '<span class="loss">'+(i?'-'+s.drop.toFixed(1)+'%':'—')+'</span></div>').join('')+'</div>';
}
function heatHTML(){
 const cd=cohortData(),names=['Wk −8','Wk −7','Wk −6','Wk −5','Wk −4','Wk −3','Wk −2','Wk −1'];
 let h='<div class="heat" style="grid-template-columns:58px repeat(8,minmax(38px,1fr))">';
 h+='<div class="hl"></div>';for(let c=0;c<8;c++)h+='<div class="hl">W'+c+'</div>';
 cd.forEach((row,r)=>{h+='<div class="hl" style="justify-content:start">'+names[r]+'</div>';
  row.forEach((v,c)=>{if(v==null){h+='<div class="hc" style="background:rgba(255,255,255,.02)"></div>';return;}
   const t=v/100,A=accentColors(),alpha=.10+t*.72;
   h+='<div class="hc" title="'+names[r]+' · Week '+c+' · '+v.toFixed(0)+'% retained" style="background:linear-gradient(135deg,'+A.c1+','+A.c2+');opacity:'+alpha.toFixed(2)+'">'+v.toFixed(0)+'</div>';});
 });return h+'</div>';}

/* ══════════════════════════════════════════════════════════════
   3 · Reusable UI blocks
   ══════════════════════════════════════════════════════════════ */
let PREV={kpi:KPI_DEF.map(k=>k.v),hero:0};
function kpiGrid(){
 const vals=kpiValues(),sp=series(S.dim,S.range).cur;
 return '<div class="kpis">'+vals.map((k,i)=>{
  const sv=sp.slice(-12).map((x,j)=>x*(KPI_DEF[i].v/9800)*k.v/KPI_DEF[i].v*(1+(noise(i*13+j,31)-.5)*.22)),
   sg=GRADS[i%GRADS.length],color=k.good?sg[1]:'#F87171';
  return '<div class="card kpi'+(k.good?'':' alert')+'" data-kpi="'+k.id+'" data-act="kpi-drill" data-v="'+k.id+'">'+
   '<div class="top"><span class="nm">'+k.label+'</span>'+ic(k.icon,'s')+'</div>'+
   '<div class="row"><div class="num" data-v="'+PREV.kpi[i]+'">'+fmt(k.kind,PREV.kpi[i])+'</div>'+
    sparkline(sv,color)+'</div>'+
   '<div class="foot">'+deltaHtml(k.d,k.goodUp)+'<span>vs. previous period</span></div></div>';
 }).join('')+'</div>';
}
function rangeSeg(){return '<div class="seg">'+Object.keys(RANGES).map(r=>'<button data-act="range" data-v="'+r+'" class="'+(S.range===r?'on':'')+'">'+r+'</button>').join('')+'</div>';}
function dimSelect(){return '<select class="sel" data-k="dim" aria-label="Data dimension" style="min-width:174px">'+
 Object.keys(DIMS).map(k=>'<option value="'+k+'"'+(S.dim===k?' selected':'')+'>'+DIMS[k].label+'</option>').join('')+'</select>';}
function exportBtn(label){return '<button class="btn gho" data-act="export">'+ic('download')+'<span>'+(label||'Export CSV')+'</span></button>';}
function pageHead(title,sub,actions){
 return '<div class="page-h"><div><h1>'+esc(title)+'</h1><p>'+esc(sub)+'</p></div><div class="actions">'+(actions||'')+'</div></div>';}
function cardHead(title,sub,right){return '<div class="card-h"><h3>'+esc(title)+'</h3>'+(sub?'<span class="sub">'+esc(sub)+'</span>':'')+
 '<div class="right">'+(right||'')+'</div></div>';}
function insightHTML(items){return items.map(x=>'<div class="insight '+x.kind+'"><div class="ix">'+ic(x.icon)+'</div><div>'+
 '<b>'+esc(x.title)+'</b><p>'+x.text+'</p><div class="meta">'+esc(x.meta)+'</div></div></div>').join('');}
function legendHTML(){return '<div class="legend"><span><i style="background:linear-gradient(90deg,'+accentColors().c1+','+accentColors().c2+')"></i>'+
 esc(DIMS[S.dim].label)+'</span>'+(S.compare?'<span><i class="dash"></i>Previous period</span>':'')+'<span class="muted">· hover for detail</span></div>';}
function feedHTML(){
 return '<div class="feed" id="liveFeed">'+S.events.map(e=>'<div class="ev">'+
  ic(e.icon,'s '+(e.kind==='good'?'up':e.kind==='bad'?'down':'info'))+
  '<div class="tx"><b>'+esc(e.title)+'</b><br>'+esc(e.sub)+'</div><span class="tm">'+(e.ago===0?'now':e.ago+'m')+'</span></div>').join('')+'</div>';
}
function donutCard(){
 const rows=channelData(S.dim),items=rows.map((r,i)=>({name:r.name,value:r.value,color:GRADS[i%GRADS.length][0]}));
 return '<div class="card"><div class="card-h"><h3>Traffic Sources</h3><span class="sub">by attribution</span>'+
  '<div class="right"><button class="icon-btn" data-act="refresh" title="Refresh">'+ic('refresh','s')+'</button></div></div>'+
  '<div class="card-b"><div class="donut-wrap">'+donutHTML(items,'src')+
  '<div class="donut-legend">'+items.map(it=>'<div class="li"><i style="background:'+it.color+'"></i>'+esc(it.name)+
   '<b>'+((it.value/sum(items.map(x=>x.value)))*100).toFixed(1)+'%</b></div>').join('')+'</div></div></div></div>';
}
function goalsCard(){
 const goals=[{n:'Q4 revenue target',v:112,c:112,good:true},{n:'Activation rate ≥ 40%',v:86,c:38.6,good:true},
  {n:'Churn below 3%',v:104,c:3.4,good:false},{n:'NPS ≥ 60',v:91,c:58,good:true}];
 return '<div class="card"><div class="card-h"><h3>Goals &amp; Targets</h3><span class="sub">quarter to date</span>'+
  '<div class="right">'+ic('target','s')+'</div></div><div class="card-b">'+goals.map(g=>{
   const col=g.good?'var(--green)':'var(--red)';
   return '<div class="goal"><div class="t">'+ic(g.good?'check-circle':'alert','s '+(g.good?'up':'down'))+esc(g.n)+
    '<b style="color:'+col+'">'+g.v+'%</b></div><div class="track"><i data-w="'+clamp(g.v,0,100)+'" style="width:0%;background:'+col+'"></i></div></div>';
  }).join('')+'</div></div>';
}
function topPagesCard(){
 const pages=[['/pricing',48210,4.8,12.4],['/product/analytics',36190,6.2,8.1],['/signup',28470,2.1,18.6],
  ['/blog/product-updates',21940,5.4,-3.2],['/integrations',17820,3.9,6.7],['/docs/api',14260,7.1,2.3]];
 return '<div class="card"><div class="card-h"><h3>Top Pages</h3><span class="sub">by engaged sessions</span>'+
  '<div class="right">'+exportBtn('')+'</div></div><div class="table-scroll"><table><thead><tr>'+
  '<th>Page</th><th>Views</th><th>Avg. time</th><th>Change</th></tr></thead><tbody>'+
  pages.map(p=>'<tr><td><span class="mono" style="color:var(--txt)">'+p[0]+'</span></td><td>'+num(p[1])+'</td><td>'+p[2].toFixed(1)+'m</td>'+
   '<td class="'+(p[3]>=0?'up':'down')+'" style="font-weight:660">'+(p[3]>=0?'+':'')+p[3].toFixed(1)+'%</td></tr>').join('')+
  '</tbody></table></div></div>';
}
function anomalyCard(){
 const sr=series(S.dim,S.range),peak=sr.cur.indexOf(Math.max.apply(null,sr.cur));
 return '<div class="card"><div class="card-h"><h3>Anomalies &amp; Watchlist</h3><span class="sub">auto-detected</span>'+
  '<div class="right"><span class="pill r">'+ic('alert')+'3 signals</span></div></div><div class="card-b">'+
  insightHTML([
   {kind:'neg',icon:'alert',title:'Bounce spike on /pricing',text:'Bounce rate climbed <b>9.4%</b> above the 7-day baseline after the new layout shipped. Segmenting shows the lift is concentrated in <b>mobile · paid social</b>.',meta:'detected 12m ago · confidence 0.94'},
   {kind:'wrn',icon:'zap',title:'Unusual '+DIMS[S.dim].label+' on '+sr.labels[peak],text:'Observed <b>'+fmt(sr.dim.unit,sr.cur[peak],true)+'</b>, outside the expected band. Correlates with a campaign launch, no data-quality issues found.',meta:'z-score 2.31 · threshold 2.0'},
   {kind:'nfo',icon:'info',title:'Retention softening in Wk −3 cohort',text:'Day-28 retention is <b>2.8 pts</b> below the trailing 8-week mean. Mostly Starter-plan accounts without an integration connected.',meta:'cohort analysis · n=1,284'}])+
  '</div></div>';
}
function methodCard(){
 const d=DIMS[S.dim];
 return '<div class="card"><div class="card-h"><h3>How this metric is calculated</h3><div class="right">'+ic('database','s')+'</div></div>'+
  '<div class="card-b"><p class="method">'+esc(d.desc)+'</p><div class="divider"></div>'+
  '<div class="formula">'+esc(d.method)+'</div><div class="divider"></div>'+
  '<div class="kv"><span>Data source</span><b>events_v3 · billing_ledger</b></div>'+
  '<div class="kv"><span>Refresh cadence</span><b>'+esc(S.settings.refresh)+'</b></div>'+
  '<div class="kv"><span>Attribution window</span><b>7 days · last non-direct</b></div>'+
  '<div class="kv"><span>Comparison basis</span><b>Previous equivalent period</b></div>'+
  '<div class="kv"><span>Target growth</span><b class="up">+'+(d.target*100).toFixed(0)+'% / period</b></div></div></div>';
}
/* ══════════════════════════════════════════════════════════════
   4 · Views
   ══════════════════════════════════════════════════════════════ */
function applyGran(sr,g){
 if(g==='Day'||sr.n<8)return sr;
 const size=g==='Week'?7:30,agg=sr.dim.unit==='money'?sum:avg,cur=[],prev=[],labels=[];
 for(let i=0;i<sr.n;i+=size){cur.push(agg(sr.cur.slice(i,i+size)));prev.push(agg(sr.prev.slice(i,i+size)));labels.push(sr.labels[i]);}
 if(cur.length<2)return sr;
 return {labels:labels,cur:cur,prev:prev,dim:sr.dim,range:sr.range,n:cur.length};}
function rtSeries(){
 const n=30,cur=[],prev=[],labels=[];
 for(let i=0;i<n;i++){cur.push(1180+Math.sin(i*.44)*140+noise(i,41)*210+i*3.2);prev.push(1020+Math.sin(i*.44)*110+noise(i,55)*180);labels.push('−'+(n-i)+'m');}
 return {labels:labels,cur:cur,prev:prev,dim:DIMS.users,range:{label:'Last 30 minutes'},n:n};}
function compareBtn(){return '<button class="btn gho" data-act="compare" title="Toggle previous period comparison">'+
 ic(S.compare?'eye':'eye-off','s')+'<span>Compare '+(S.compare?'on':'off')+'</span></button>';}
function heroCard(){
 const sr=series(S.dim,S.range),hv=heroValue(sr),growth=pctDelta(sum(sr.cur),sum(sr.prev)),
   peak=Math.max.apply(null,sr.cur),target=DIMS[S.dim].target*100,good=growth>=0;
 return '<div class="card hero"><div><div class="lbl">'+esc(hv.label)+'</div>'+
  '<div class="big" id="heroNum" data-v="'+PREV.hero+'">'+fmt(hv.kind,PREV.hero,false)+'</div>'+
  '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+deltaHtml(growth,true,{suffix:'vs. previous period'})+
  '<span class="pill '+(growth>=target?'g':'a')+'">'+ic(growth>=target?'check-circle':'target')+(growth>=target?'Above':'Below')+' +'+target.toFixed(0)+'% target</span></div></div>'+
  '<div class="cmp"><div><span>Previous period</span><b>'+fmt(hv.kind,sr.dim.unit==='money'?sum(sr.prev):avg(sr.prev),true)+'</b></div>'+
  '<div><span>Period peak</span><b>'+fmt(hv.kind,peak,true)+'</b></div>'+
  '<div><span>Sample size</span><b>'+num(sr.n)+' pts</b></div>'+
  '<div><span>Confidence</span><b class="'+(good?'up':'down')+'">94.2%</b></div></div></div>';
}
function mainChartCard(id,title,sub,opts){
 return '<div class="card">'+cardHead(title,sub,rangeSeg())+
  '<div class="card-b" style="padding-bottom:10px">'+chartSlot(id,opts||{})+
  '<div style="margin-top:4px;padding-left:2px">'+legendHTML()+'</div></div></div>';
}
function channelCard(){
 const rows=channelData(S.dim);
 return '<div class="card">'+cardHead('Channel Breakdown','share of '+DIMS[S.dim].label.toLowerCase(),
   '<span class="pill n">'+rows.length+' sources</span>')+
  '<div class="card-b">'+barsHTML(rows)+'<div class="divider"></div>'+
  '<div class="kv"><span>Top contributor</span><b>'+esc(rows.slice().sort((a,b)=>b.value-a.value)[0].name)+'</b></div>'+
  '<div class="kv"><span>Highest momentum</span><b class="up">'+esc(rows.slice().sort((a,b)=>b.delta-a.delta)[0].name)+'</b></div>'+
  '<div class="kv"><span>At risk</span><b class="down">'+esc(rows.slice().sort((a,b)=>a.delta-b.delta)[0].name)+'</b></div></div></div>';
}
function funnelCard(){
 const steps=funnelData();
 return '<div class="card">'+cardHead('Conversion Funnel','visitor → retained','<span class="pill b">'+ic('funnel')+'9.1% end-to-end</span>')+
  '<div class="card-b">'+funnelHTML(steps)+'<div class="divider"></div>'+
  '<p class="muted" style="font-size:10.5px;line-height:1.6">Biggest drop-off: <b style="color:var(--red)">Signed up → Activated ('+steps[2].drop.toFixed(1)+'%)</b>. Connect an integration within 24h to lift activation by an estimated 6.2 pts.</p></div></div>';
}
function liveCard(){
 return '<div class="card">'+cardHead('Live Activity','streaming events','<span class="pill g">'+ic('activity')+'<span class="pulse" style="width:7px;height:7px"></span> Live</span>')+
  '<div class="card-b" style="padding-top:6px">'+feedHTML()+'</div></div>';
}
function heatCard(){
 return '<div class="card">'+cardHead('Cohort Retention','weekly cohorts · % retained',
  '<div class="legend"><span><i style="background:'+accentColors().c1+'"></i>low</span><span><i style="background:'+accentColors().c2+'"></i>high</span></div>')+
  '<div class="card-b">'+heatHTML()+'<div class="divider"></div>'+
  '<div class="kv"><span>Week-1 retention</span><b>78.4% <span class="up" style="font-size:10px">+2.1 pts</span></b></div>'+
  '<div class="kv"><span>Week-4 retention</span><b>46.2% <span class="down" style="font-size:10px">−1.4 pts</span></b></div></div></div>';
}
function hourCard(){
 const rows=Array.from({length:12},(_,i)=>({name:(i*2)+':00 – '+(i*2+2)+':00',value:Math.round(2200+Math.sin(i*.7)*1300+noise(i,63)*900)}));
 return '<div class="card">'+cardHead('Activity by Hour','UTC · engaged sessions','<span class="pill n">Peak 14:00–16:00</span>')+
  '<div class="card-b">'+barsHTML(rows,{alt:true})+'</div></div>';
}
function deviceCard(){
 const items=[{name:'Desktop',value:58.4},{name:'Mobile',value:31.2},{name:'Tablet',value:7.1},{name:'Other',value:3.3}];
 return '<div class="card">'+cardHead('Device Mix','sessions by device class','<span class="pill n">'+ic('pie')+'split</span>')+
  '<div class="card-b"><div class="donut-wrap">'+donutHTML(items.map((x,i)=>Object.assign({},x,{color:GRADS[i][0]})),'dev')+
  '<div class="donut-legend">'+items.map((it,i)=>'<div class="li"><i style="background:'+GRADS[i][0]+'"></i>'+it.name+'<b>'+it.value.toFixed(1)+'%</b></div>').join('')+
  '</div></div></div></div>';
}

/* ── Users table ────────────────────────────────────────────── */
function tableRows(){
 const t=S.table,q=t.q.trim().toLowerCase();
 let l=S.users.filter(u=>{
  if(t.status!=='All'&&u.status!==t.status)return false;
  if(!q)return true;
  return [u.name,u.email,u.plan,u.role,u.country,u.status,u.id].join(' ').toLowerCase().indexOf(q)>=0;});
 const dir=t.dir==='asc'?1:-1;
 l.sort((a,b)=>{const x=a[t.sort],y=b[t.sort];if(typeof x==='string')return x.localeCompare(y)*dir;return (x-y)*dir;});
 return l;}
function thCell(key,label){const t=S.table,on=t.sort===key;
 return '<th class="sortable'+(on?' sorted':'')+'" data-act="sort" data-v="'+key+'">'+esc(label)+
  ic(on?(t.dir==='asc'?'arrow-up':'arrow-down'):'chev-down','xs')+'</th>';}
function tableCounts(){const c={All:S.users.length,Active:0,Pending:0,Churned:0};S.users.forEach(u=>c[u.status]++);return c;}
function bulkHTML(){
 const t=S.table;if(!t.sel.length)return '';
 return '<div class="bulk">'+ic('check-circle','s')+'<b>'+t.sel.length+' selected</b>'+
  '<button class="btn sm gho" data-act="bulk-activate">Set Active</button>'+
  '<button class="btn sm gho" data-act="bulk-export">Export selected</button>'+
  '<button class="btn sm danger" data-act="bulk-delete">'+ic('trash')+'Remove</button>'+
  '<button class="btn sm gho" data-act="bulk-clear" style="margin-left:auto">Clear</button></div>';
}
function usersTableCard(){return '<div class="card" id="tableCard">'+tableCardInner()+'</div>';}
/* soft = only the body/footer/bulk bar change; the search input stays mounted so
   typing, IME composition and caret position are never interrupted. */
function userForm(u){
 const f=(lbl,k,val,type)=>'<div class="field"><label>'+lbl+'</label><input class="inp" id="'+k+'" type="'+(type||'text')+'" value="'+esc(val)+'"></div>';
 const sel=(lbl,k,val,arr)=>'<div class="field"><label>'+lbl+'</label><select class="sel" id="'+k+'">'+arr.map(x=>'<option'+(x===val?' selected':'')+'>'+x+'</option>').join('')+'</select></div>';
 return '<div class="form-grid">'+f('Full name','f-name',u.name)+f('Email','f-email',u.email,'email')+
  sel('Status','f-status',u.status,STATUSES)+sel('Plan','f-plan',u.plan,PLANS)+
  sel('Role','f-role',u.role,ROLES)+f('MRR (USD)','f-mrr',u.mrr,'number')+
  '<div class="field full"><label>Workspace note</label><textarea class="inp" id="f-note" placeholder="Internal note (not shown to the user)">'+esc(u.note||'')+'</textarea></div></div>';
}
function readUserForm(){
 return {name:$('#f-name').value.trim(),email:$('#f-email').value.trim(),status:$('#f-status').value,
  plan:$('#f-plan').value,role:$('#f-role').value,mrr:Math.max(0,parseFloat($('#f-mrr').value)||0),note:$('#f-note').value};}

const VIEWS={
 dashboard:function(){
  return pageHead('Overview','Olivia — activation fell 6.2 pts after the Nov 3 release. Two things need your call today.',
    rangeSeg()+compareBtn()+exportBtn())+kpiGrid()+
   '<div class="g2">'+mainChartCard('ch-main',DIMS[S.dim].label+' Overview',RANGES[S.range].label)+
    liveCard()+'</div>'+
   '<div class="g3">'+channelCard()+funnelCard()+goalsCard()+'</div>'+
   '<div class="g2">'+anomalyCard()+'<div>'+donutCard()+'<div style="height:14px"></div>'+deviceCard()+'</div></div>'+
   '<div class="g2">'+heatCard()+topPagesCard()+'</div>'+
   '<div class="g2b">'+hourCard()+'<div class="card">'+cardHead('What changed this week','narrative summary')+
    '<div class="card-b">'+insightHTML(insightsFor(series(S.dim,S.range)).slice(0,3))+'</div></div></div>';
 },
 analytics:function(){
  const sr=series(S.dim,S.range),gran=applyGran(sr,S.gran);
  return pageHead('Analytics','Slice every metric by dimension, time range and granularity.',
    dimSelect()+'<select class="sel" data-k="gran" aria-label="Granularity">'+
     ['Day','Week','Month'].map(g=>'<option'+(S.gran===g?' selected':'')+'>'+g+'</option>').join('')+'</select>'+
    compareBtn()+exportBtn())+
   heroCard()+kpiGrid()+
   '<div class="g2">'+mainChartCard('ch-an',DIMS[S.dim].label+' Trend',S.gran+' granularity · '+RANGES[S.range].label,{series:gran,height:310})+
    methodCard()+'</div>'+
   '<div class="g2b">'+channelCard()+'<div class="card">'+cardHead('Automated Insights','computed from current series')+
    '<div class="card-b">'+insightHTML(insightsFor(sr))+'</div></div></div>'+
   '<div class="g2b">'+hourCard()+funnelCard()+'</div>'+
   '<div class="g2">'+heatCard()+topPagesCard()+'</div>';
 },
 realtime:function(){
  return pageHead('Realtime','What is happening in your product right now.',
    '<span class="pill g">'+ic('activity')+'<span class="pulse" style="width:7px;height:7px"></span> Streaming</span>'+exportBtn())+
   '<div class="g2"><div class="card">'+cardHead('Users right now','last 30 minutes',
    '<span class="pill g">'+ic('arrow-ur')+'+6.8% vs 1h ago</span>')+
    '<div class="card-b"><div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:6px">'+
    '<div class="big" id="rtNum" style="font-size:40px;font-weight:760;letter-spacing:-.05em">1,284</div>'+
    '<span class="pulse" style="margin-bottom:14px"></span><span class="muted" style="margin-bottom:12px">active sessions</span></div>'+
    chartSlot('ch-rt',{series:rtSeries(),compare:false,height:230})+'</div></div>'+
    liveCard()+'</div>'+
   '<div class="g3">'+
    '<div class="card">'+cardHead('Top locations','live sessions')+'<div class="card-b">'+barsHTML([
     {name:'United States',value:4820,delta:4.2},{name:'United Kingdom',value:2140,delta:1.8},
     {name:'Germany',value:1680,delta:-0.9},{name:'Canada',value:1210,delta:3.1},
     {name:'Netherlands',value:840,delta:6.4},{name:'Australia',value:620,delta:-2.2}],{})+'</div></div>'+
    '<div class="card">'+cardHead('Top pages now','active viewers')+'<div class="card-b">'+barsHTML([
     {name:'/pricing',value:412},{name:'/product/analytics',value:287},{name:'/signup',value:198},
     {name:'/docs/api',value:144},{name:'/blog',value:96}],{alt:true})+'</div></div>'+
    '<div class="card">'+cardHead('Event throughput','events / second')+'<div class="card-b">'+
     '<div class="kv"><span>Current</span><b class="up">2,847 /s</b></div><div class="kv"><span>Peak (1h)</span><b>3,912 /s</b></div>'+
     '<div class="kv"><span>Ingest latency</span><b>42 ms</b></div><div class="kv"><span>Error rate</span><b class="up">0.02%</b></div>'+
     '<div class="divider"></div><p class="muted" style="font-size:10.5px">All pipelines healthy. Last check 8 seconds ago.</p></div></div></div>';
 },
 funnels:function(){
  const steps=funnelData();
  return pageHead('Funnels','Where users drop off between first touch and retained subscription.',rangeSeg()+exportBtn())+
   '<div class="g2"><div class="card">'+cardHead('Acquisition → Retention','all traffic · '+RANGES[S.range].label,
    '<span class="pill b">'+ic('funnel')+'9.1% end-to-end</span>')+
    '<div class="card-b">'+funnelHTML(steps)+'</div></div>'+
    '<div class="card">'+cardHead('Step-by-step detail','absolute counts & loss')+
    '<div class="table-scroll"><table><thead><tr><th>Step</th><th>Users</th><th>Conv.</th><th>Drop</th></tr></thead><tbody>'+
    steps.map(s=>'<tr><td style="color:var(--txt)">'+esc(s.name)+'</td><td class="mono">'+num(s.v)+'</td><td>'+s.pct.toFixed(1)+'%</td>'+
     '<td class="'+(s.drop>40?'down':'warn')+'">'+(s.drop?s.drop.toFixed(1)+'%':'—')+'</td></tr>').join('')+
    '</tbody></table></div><div class="card-b" style="border-top:1px solid var(--line)">'+insightHTML([
     {kind:'neg',icon:'alert',title:'Activation is the bottleneck',text:'Only <b>67.5%</b> of signups reach activation. Users who connect an integration in the first session retain <b>2.3×</b> better.',meta:'segment: all plans · n=54,320'},
     {kind:'pos',icon:'check-circle',title:'Paid conversion improved',text:'Signed up → Subscribed is up <b>1.8 pts</b> since the pricing page redesign shipped on Nov 2.',meta:'A/B test · variant B · p=0.03'}])+'</div></div></div>'+
   '<div class="g2b">'+channelCard()+hourCard()+'</div>';
 },
 cohorts:function(){
  return pageHead('Cohorts','Retention by signup week — spot decay before it hits revenue.',rangeSeg()+exportBtn())+
   '<div class="g2"><div class="card">'+cardHead('Retention heatmap','8 weekly cohorts × 8 weeks',
    '<div class="legend"><span><i style="background:'+accentColors().c1+'"></i>low</span><span><i style="background:'+accentColors().c2+'"></i>high</span></div>')+
    '<div class="card-b">'+heatHTML()+'</div></div>'+
    '<div class="card">'+cardHead('Retention curve','average across cohorts')+'<div class="card-b">'+
    chartSlot('ch-co',{series:(function(){const vals=[100,78.4,66.1,57.3,46.2,41.8,38.4,35.1];
     return {labels:vals.map((_,i)=>'W'+i),cur:vals,prev:vals.map(v=>v*.93),dim:DIMS.users,range:{label:'retention'},n:vals.length};})(),compare:true,height:280})+'</div></div></div>'+
   '<div class="g3">'+
    '<div class="card">'+cardHead('Best cohort','Wk −6')+'<div class="card-b">'+
     '<div class="kv"><span>Week-1</span><b class="up">84.2%</b></div><div class="kv"><span>Week-4</span><b class="up">52.1%</b></div>'+
     '<div class="kv"><span>Acquisition</span><b>Organic Search</b></div><div class="kv"><span>Accounts</span><b>1,284</b></div></div></div>'+
    '<div class="card">'+cardHead('Weakest cohort','Wk −3')+'<div class="card-b">'+
     '<div class="kv"><span>Week-1</span><b class="down">71.6%</b></div><div class="kv"><span>Week-4</span><b class="down">39.8%</b></div>'+
     '<div class="kv"><span>Acquisition</span><b>Paid Social</b></div><div class="kv"><span>Accounts</span><b>1,902</b></div></div></div>'+
    '<div class="card">'+cardHead('Read the numbers','methodology')+'<div class="card-b"><p class="method">Each row is a group of users who signed up in the same week. Cells show the share still active N weeks later. Blank cells are future periods.</p>'+
     '<div class="divider"></div><div class="kv"><span>Definition of active</span><b>≥1 core event / week</b></div>'+
     '<div class="kv"><span>Excludes</span><b>staff + trial bots</b></div></div></div></div>';
 },
 reports:function(){
  return pageHead('Reports','Scheduled deliverables and on-demand exports.',
    '<button class="btn pri" data-act="gen-report">'+ic('sparkle')+'<span>Generate report</span></button>')+
   '<div class="g2"><div class="card">'+cardHead('Report library','4 saved reports',exportBtn(''))+
    '<div class="card-b">'+S.reports.map(r=>'<div class="insight '+r.kind+'" style="margin-bottom:10px"><div class="ix">'+ic(r.icon)+'</div><div>'+
     '<b>'+esc(r.name)+'</b><p>'+esc(r.desc)+'</p><div class="meta">'+esc(r.cadence)+'</div></div>'+
     '<button class="btn sm gho" data-act="run-report" data-v="'+esc(r.name)+'" style="margin-left:auto;align-self:center">'+ic('download')+'Run</button></div>').join('')+'</div></div>'+
    '<div class="card">'+cardHead('Delivery schedule','recurring')+'<div class="card-b">'+
     '<div class="kv"><span>Next send</span><b>Mon, Nov 9 · 08:00</b></div>'+
     '<div class="kv"><span>Recipients</span><b>6 workspace members</b></div>'+
     '<div class="kv"><span>Format</span><b>PDF + CSV attachment</b></div>'+
     '<div class="kv"><span>Timezone</span><b>'+esc(S.settings.timezone)+'</b></div>'+
     '<div class="divider"></div>'+insightHTML([
      {kind:'nfo',icon:'info',title:'Report freshness',text:'Data is snapshotted 15 minutes before each send. Late-arriving events are backfilled into the next run.',meta:'pipeline: events_v3 → warehouse'}])+
     '</div></div></div>'+'<div class="g2">'+heatCard()+topPagesCard()+'</div>';
 },
 billing:function(){
  const inv=[['INV-2026-1101','Nov 1, 2026','$1,249.00','Paid'],['INV-2026-1001','Oct 1, 2026','$1,249.00','Paid'],
   ['INV-2026-0901','Sep 1, 2026','$1,089.00','Paid'],['INV-2026-0801','Aug 1, 2026','$1,089.00','Paid'],
   ['INV-2026-0701','Jul 1, 2026','$899.00','Paid']];
  return pageHead('Billing','Plan, usage and invoices for Northstar Labs.',
    '<button class="btn pri" data-act="upgrade">'+ic('zap')+'<span>Upgrade plan</span></button>')+
   '<div class="g2"><div class="card">'+cardHead('Current plan','Scale · billed monthly',
    '<span class="pill g">'+ic('check-circle')+'Active</span>')+
    '<div class="card-b"><div style="display:flex;align-items:baseline;gap:9px"><span style="font-size:34px;font-weight:750;letter-spacing:-.04em">$1,249</span>'+
    '<span class="muted">/ month</span></div><p class="muted" style="font-size:11px;margin:6px 0 16px">Renews Dec 1, 2026 · 6 seats · unlimited events</p>'+
    [['Tracked events','1.82M / 3M',60.7],['Seats','6 / 10',60],['Dashboards','18 / 25',72],['Data retention','11 / 24 mo',45.8]]
    .map(x=>'<div class="goal"><div class="t">'+esc(x[0])+'<b>'+esc(x[1])+'</b></div><div class="track"><i data-w="'+x[2]+'" style="width:0%"></i></div></div>').join('')+
    '</div></div>'+
    '<div class="card">'+cardHead('Cost breakdown','this billing cycle')+'<div class="card-b">'+
    barsHTML([{name:'Base platform',value:899},{name:'Additional seats',value:180},{name:'Event overage',value:112},{name:'Premium support',value:58}],{green:true})+
    '<div class="divider"></div><div class="kv"><span>Subtotal</span><b>$1,249.00</b></div>'+
    '<div class="kv"><span>Tax (0%)</span><b>$0.00</b></div><div class="kv"><span>Amount due</span><b class="up">$1,249.00</b></div>'+
    '</div></div></div>'+
   '<div class="card">'+cardHead('Invoices','last 5 billing periods',exportBtn(''))+
    '<div class="table-scroll"><table><thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th style="text-align:right">Action</th></tr></thead><tbody>'+
    inv.map(r=>'<tr><td class="mono" style="color:var(--txt)">'+r[0]+'</td><td>'+r[1]+'</td><td class="mono">'+r[2]+'</td>'+
     '<td><span class="tag Active"><span class="bdot"></span>'+r[3]+'</span></td>'+
     '<td style="text-align:right"><button class="btn sm gho" data-act="run-report" data-v="'+r[0]+'">'+ic('download')+'PDF</button></td></tr>').join('')+
    '</tbody></table></div></div>';
 },

};

/* ══════════════════════════════════════════════════════════════
   5 · Shell rendering, routing, effects
   ══════════════════════════════════════════════════════════════ */
function renderSide(page){
 let h='<div class="brand"><span class="mark">'+ic('zap')+'</span><span class="nm">northstar<small>product analytics</small></span>'+
  '<button class="drawer-close" data-act="mobile-menu" aria-label="Close menu">'+ic('x','s')+'</button></div>'+
  '<div class="side-scroll">';
 NAV.forEach(g=>{h+='<div class="nav-lab">'+g.group+'</div>'+g.items.map(it=>{
  const on=page===it.id;return '<button class="nav-item '+(on?'on':'')+'" data-act="nav" data-v="'+it.id+'" title="'+it.label+'">'+
   ic(it.icon)+'<span class="lbl">'+it.label+'</span>'+
   (it.live?'<span class="pulse" style="width:6px;height:6px;margin-right:2px"></span>':
    it.count?'<span class="cnt'+(it.id==='users'?'':' hot')+'">'+it.count+'</span>':'')+'</button>';}).join('');});
 h+='</div><div class="side-foot"><div class="upgrade"><b>Scale plan</b><p>1.82M of 3M events used this cycle.</p>'+
  '<div class="bar"><i style="width:61%"></i></div><button class="btn sm gho" style="width:100%" data-act="nav" data-v="billing">Manage plan '+ic('arrow-right','xs')+'</button></div>'+
  '<div class="who-row" data-act="nav" data-v="settings">'+avatar({initials:'OB',g:0},'sm')+
  '<span class="who"><b>Olivia Bennett</b><small>Workspace owner</small></span>'+ic('dots','s')+'</div></div>';
 $('#side').innerHTML=h;}
function renderTop(page){
 const unread=S.notifications.filter(n=>!n.read).length;
 const name=(NAV.reduce((a,g)=>a.concat(g.items),[]).find(x=>x.id===page)||{}).label||'Dashboard';
 $('#topbar').innerHTML='<button class="hamb" data-act="mobile-menu" aria-label="Menu">'+ic('menu','s')+'</button>'+
  '<button class="icon-btn" data-act="toggle-side" title="Collapse sidebar" style="display:'+(window.innerWidth<960?'none':'grid')+'">'+ic('menu','s')+'</button>'+
  '<div class="crumb"><span class="parent">Workspace</span><span class="sep">/</span><b>'+esc(name)+'</b></div><div class="grow"></div>'+
  '<div class="glob-search">'+ic('search')+'<input id="globQ" placeholder="Search anything…" data-k="glob"><span class="kbd">⌘K</span></div>'+
  '<button class="icon-btn" data-act="cmd-open" title="Command palette (⌘K)">'+ic('command','s')+'</button>'+
  '<div style="position:relative"><button class="icon-btn" data-act="notif-toggle" title="Notifications">'+ic('bell','s')+
   (unread?'<span class="dot"></span>':'')+'</button><div class="popover" id="notifPop">'+
   '<div class="pop-h">'+ic('bell','s')+'Notifications'+(unread?'<span class="pill b">'+unread+' new</span>':'')+
   '<button class="btn sm gho" data-act="read-all">Mark all read</button></div>'+
   S.notifications.map(n=>'<div class="notif '+(n.read?'':'unread')+'">'+
    ic(n.icon,'s '+(n.kind==='good'?'up':n.kind==='bad'?'down':'info'))+
    '<div><b>'+esc(n.title)+'</b>'+esc(n.sub)+'<br><small>'+esc(n.ago)+'</small></div></div>').join('')+'</div></div>'+
  avatar({initials:'OB',g:0},'sm');
}
function animateHero(){
 const el=$('#heroNum');if(!el)return;
 const hv=heroValue(series(S.dim,S.range));animateNum(el,hv.v,x=>fmt(hv.kind,x,false),900);
 return hv.v;}


/* ── Command palette ────────────────────────────────────────── */
let CMD_ITEMS=[],CMD_IDX=0;
function cmdData(){
 const items=NAV.reduce((a,g)=>a.concat(g.items),[]).map(x=>({icon:x.icon,label:'Go to '+x.label,hint:'Navigation',run:()=>go(x.id)}));
 items.push({icon:'download',label:'Export current data as CSV',hint:'Action',run:()=>exportCurrent()});
 items.push({icon:'user-plus',label:'Add a new user',hint:'Action',run:()=>editUser('new')});
 items.push({icon:'refresh',label:'Reload data from source',hint:'Action',run:()=>refreshCurrentView()});
 items.push({icon:'zap',label:'Load 5,000 demo users (virtual scroll)',hint:'Action',run:()=>{expandUsers(5000);go('users');toast('Virtual list','5,000 rows, only visible DOM mounted','ok');}});
 items.push({icon:'arrow-right',label:'Sign out (test route guard)',hint:'Action',run:()=>signOut()});
 items.push({icon:'rotate',label:'Reset demo workspace',hint:'Action',run:()=>resetData()});
 return items;}
function renderCmd(q){
 q=(q||'').toLowerCase();CMD_ITEMS=cmdData().filter(x=>x.label.toLowerCase().indexOf(q)>=0);CMD_IDX=0;
 const list='<div class="cmd-list">'+CMD_ITEMS.map((x,i)=>'<button class="cmd-item '+(i===0?'cur':'')+'" data-act="cmd-run" data-v="'+i+'">'+
   ic(x.icon,'s')+esc(x.label)+'<small>'+esc(x.hint)+'</small></button>').join('')+
   (CMD_ITEMS.length?'':'<div class="empty"><b>No matching commands</b><p>Try “analytics”, “export” or “users”.</p></div>')+'</div>';
 const box=$('#cmd'),wasOpen=box.classList.contains('show');
 if(box.querySelector('.cmd-in')){const l=box.querySelector('.cmd-list');if(l)l.outerHTML=list;}
 else box.innerHTML='<div class="cmd-in">'+ic('command','s')+
   '<input id="cmdInput" data-k="cmdq" placeholder="Jump to a page or run a command…" autocomplete="off"><span class="kbd">ESC</span></div>'+list;
 if(!wasOpen)setTimeout(()=>{const i=$('#cmdInput');if(i){i.value='';i.focus();}},20);
 box.classList.add('show');}
function closeCmd(){$('#cmd').classList.remove('show');}
function cmdMove(d){if(!CMD_ITEMS.length)return;CMD_IDX=(CMD_IDX+d+CMD_ITEMS.length)%CMD_ITEMS.length;
 $$('#cmd .cmd-item').forEach((el,i)=>el.classList.toggle('cur',i===CMD_IDX));}

/* ── Realtime ticker ────────────────────────────────────────── */
let RT=null;
function startRealtime(){if(RT)return;
 RT=setInterval(()=>{
  const n=$('#rtNum');if(n){const v=1180+Math.round(Math.random()*230);animateNum(n,v,x=>num(x),600);}
  const feed=$('#liveFeed');if(feed){
   const kinds=[['zap','New subscription','Growth plan · Kestrelworks','info'],['user-plus','Signup completed','Referral · Germany','good'],
    ['card','Payment received','$249.00 · Vexa','good'],['activity','Session milestone','10k concurrent events','info']];
   const k=kinds[Math.floor(Math.random()*kinds.length)],d=document.createElement('div');
   d.className='ev';d.innerHTML=ic(k[0],'s '+(k[3]==='good'?'up':'info'))+'<div class="tx"><b>'+k[1]+'</b><br>'+k[2]+'</div><span class="tm">now</span>';
   feed.insertBefore(d,feed.firstChild);while(feed.children.length>9)feed.removeChild(feed.lastChild);
   $$('#liveFeed .ev').slice(1).forEach((el,i)=>{const t=el.querySelector('.tm');if(t&&t.textContent==='now')t.textContent=(i+1)+'m';});
  }
 },7000);}
function stopRealtime(){if(RT){clearInterval(RT);RT=null;}}

/* ── Export / reset ─────────────────────────────────────────── */
function exportCurrent(){
 const p=parseRoute();
 if(p==='users'){
  const rows=[['ID','Name','Email','Status','Plan','Role','MRR','Country','Last active (min)','Joined']].concat(
   tableRows().map(u=>[u.id,u.name,u.email,u.status,u.plan,u.role,u.mrr,u.country,u.last,u.joined]));
  downloadCSV('northstar-users.csv',rows);return;}
 if(p==='billing'){downloadCSV('northstar-invoices.csv',[['Invoice','Date','Amount','Status'],
  ['INV-2026-1101','Nov 1, 2026','$1,249.00','Paid'],['INV-2026-1001','Oct 1, 2026','$1,249.00','Paid']]);return;}
 const sr=series(S.dim,S.range),rows=[[ 'Date',DIMS[S.dim].label,'Previous period','Change %']];
 sr.labels.forEach((l,i)=>rows.push([l,sr.cur[i].toFixed(2),sr.prev[i].toFixed(2),pctDelta(sr.cur[i],sr.prev[i]).toFixed(2)]));
 downloadCSV('northstar-'+S.dim+'-'+S.range+'.csv',rows);}
function resetData(){
 confirmBox('Reset demo workspace?','This restores all users, filters, settings, notifications and appearance to their original seeded values. <b>This cannot be undone.</b>','Reset everything',()=>{
  try{localStorage.removeItem(KEY);}catch(e){}S=seedState();document.documentElement.dataset.accent=S.accent;
  save();closeModal();go('dashboard');toast('Workspace reset','All demo data restored','ok');});}

/* ── User CRUD ──────────────────────────────────────────────── */
function editUser(id){
 const isNew=id==='new',u=isNew?{name:'',email:'',status:'Pending',plan:'Starter',role:'Viewer',mrr:0,note:''}:S.users.find(x=>x.id===id);
 if(!u)return;
 openModal(isNew?'Add a new user':'Edit user',userForm(u),
  '<button class="btn gho" data-act="close-modal">Cancel</button><button class="btn pri" data-act="user-save" data-v="'+id+'">'+
  ic('save')+(isNew?'Create user':'Save changes')+'</button>');}
function saveUser(id){
 const f=readUserForm();if(!f.name||!f.email){toast('Missing fields','Name and email are required','err');return;}
 if(id==='new'){
  const parts=f.name.split(' '),u=Object.assign({},f,{id:'U-'+(1001+S.users.length),
   initials:((parts[0]||'?')[0]+(parts[1]||parts[0]||'?')[0]).toUpperCase(),g:S.users.length%GRADS.length,
   country:'United States',last:0,sessions:0,joined:new Date().toISOString().slice(0,10),bars:Array.from({length:14},()=>8)});
  S.users.unshift(u);S.table.page=1;toast('User created',u.name+' added to the workspace','ok');
 }else{const u=S.users.find(x=>x.id===id);if(!u)return;Object.assign(u,f);toast('Changes saved',u.name+' updated','ok');}
 save();closeModal();updateTable();}
function deleteUsers(ids){
 const n=ids.length;S.users=S.users.filter(u=>ids.indexOf(u.id)<0);S.table.sel=[];S.table.open=null;save();closeModal();updateTable();
 toast(n+' user'+(n>1?'s':'')+' removed','The workspace list has been updated','ok');}

/* ══════════════════════════════════════════════════════════════
   6 · Event delegation
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('click',function(e){
 const el=e.target.closest('[data-act],[data-go]');if(!el)return;
 const a=el.getAttribute('data-act')||'nav',v=el.getAttribute('data-v')||el.getAttribute('data-go');
 if(el.tagName==='INPUT'&&el.type==='checkbox'&&a!=='sel-all'&&a!=='sel-one')return;
 switch(a){
  case 'nav':go(v);$('#app').classList.remove('mobile-open');break;
  case 'login-submit':doLogin();break;
  case 'sign-out':signOut();break;
  case 'sim-force':NET.forceFail=!NET.forceFail;saveNet();el.classList.toggle('on',NET.forceFail);
   toast('Simulation',NET.forceFail?'Every request will now fail':'Failures disabled',NET.forceFail?'err':'ok');break;
  case 'sim-next':NET.failNext=true;saveNet();toast('Simulation armed','The next view load will fail once','inf');break;
  case 'sim-reload':refreshCurrentView();break;
  case 'load-rows':expandUsers(+v||5000);render();toast('Dataset loaded',num(S.users.length)+' rows · virtual scrolling active','ok');break;
  case 'restore-rows':restoreUsers();render();toast('Dataset restored','Back to the seeded 28 accounts','ok');break;
  case 'toggle-side':S.collapsed=!S.collapsed;save();render();break;
  case 'mobile-menu':$('#app').classList.toggle('mobile-open');break;
  case 'range':S.range=v;save();render();toast('Range updated',RANGES[v].label,'inf');break;
  case 'compare':S.compare=!S.compare;save();render();break;
  case 'export':exportCurrent();break;
  case 'refresh':refreshCurrentView();toast('Refreshing','Re-requesting data from the source','inf');break;
  case 'kpi-drill':{const map={rev:'revenue',usr:'users',ses:'users',bnc:'conversion'};S.dim=map[v]||'revenue';save();go('analytics');break;}
  case 'close-modal':closeModal();break;
  case 'confirm-yes':if(window.__confirm)window.__confirm();break;
  case 'notif-toggle':$('#notifPop').classList.toggle('show');break;
  case 'read-all':S.notifications.forEach(n=>n.read=true);save();renderTop(parseRoute());
   $('#notifPop').classList.add('show');toast('All caught up','Notifications marked as read','ok');break;
  case 'cmd-open':renderCmd('');break;
  case 'cmd-run':{const it=CMD_ITEMS[+v];if(it){closeCmd();it.run();}break;}
  /* Users table */
  case 'chip':S.table.status=v;S.table.page=1;save();updateTable();break;
  case 'sort':if(S.table.sort===v)S.table.dir=S.table.dir==='asc'?'desc':'asc';else{S.table.sort=v;S.table.dir='asc';}
   save();updateTable();break;
  case 'page':{const p=+v,pages=Math.max(1,Math.ceil(tableRows().length/S.table.per));if(p<1||p>pages)return;
   S.table.page=p;save();updateTable();break;}
  case 'sel-all':{const list=isVirtual()?tableRows():tableRows().slice((S.table.page-1)*S.table.per,S.table.page*S.table.per);
   const all=list.every(r=>S.table.sel.indexOf(r.id)>=0);
   S.table.sel=all?S.table.sel.filter(id=>!list.some(r=>r.id===id)):Array.from(new Set(S.table.sel.concat(list.map(r=>r.id))));
   save();updateTable();break;}
  case 'sel-one':{const i=S.table.sel.indexOf(v);if(i<0)S.table.sel.push(v);else S.table.sel.splice(i,1);save();updateTable();break;}
  case 'user-open':if(isVirtual()){editUser(v);break;}
   S.table.open=S.table.open===v?null:v;save();updateTable();break;
  case 'user-edit':editUser(v);break;
  case 'user-add':editUser('new');break;
  case 'user-save':saveUser(v);break;
  case 'user-del':{const u=S.users.find(x=>x.id===v);if(!u)return;
   confirmBox('Remove '+u.name+'?','This will remove <b>'+esc(u.email)+'</b> from the workspace demo data. You can restore everything from Settings → Reset demo workspace.','Remove user',()=>deleteUsers([v]));break;}
  case 'bulk-clear':S.table.sel=[];save();updateTable();break;
  case 'bulk-activate':{S.users.forEach(u=>{if(S.table.sel.indexOf(u.id)>=0)u.status='Active';});S.table.sel=[];save();updateTable();
   toast('Status updated','Selected users are now Active','ok');break;}
  case 'bulk-export':{const ids=S.table.sel.slice(),rows=[['ID','Name','Email','Status','Plan','MRR']].concat(
    S.users.filter(u=>ids.indexOf(u.id)>=0).map(u=>[u.id,u.name,u.email,u.status,u.plan,u.mrr]));
   downloadCSV('northstar-selected-users.csv',rows);break;}
  case 'bulk-delete':confirmBox('Remove '+S.table.sel.length+' users?','This removes every selected account from the demo workspace and clears the selection.','Remove all',()=>deleteUsers(S.table.sel.slice()));break;
  /* Settings & misc */
  case 'toggle':S.settings.toggles[v]=!S.settings.toggles[v];save();
   el.classList.toggle('on',S.settings.toggles[v]);toast('Preference saved','Notification settings updated','ok');break;
  case 'accent':S.accent=v;save();document.documentElement.dataset.accent=v;render();
   toast('Accent updated',ACCENTS.find(x=>x.id===v).name+' applied to all charts','ok');break;
  case 'copy-key':{const t=S.settings.apiKey;
   if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).catch(()=>{});
   toast('API key copied','Paste it somewhere safe','ok');break;}
  case 'save-settings':$$('[data-set]').forEach(x=>{S.settings[x.getAttribute('data-set')]=x.value;});save();render();
   toast('Settings saved','Workspace preferences persisted','ok');break;
  case 'reset-data':resetData();break;
  case 'gen-report':openModal('Generate a report',
   '<div class="form-grid"><div class="field full"><label>Report name</label><input class="inp" id="r-name" value="Custom analytics snapshot"></div>'+
   '<div class="field"><label>Metric</label><select class="sel" id="r-dim">'+Object.keys(DIMS).map(k=>'<option value="'+k+'">'+DIMS[k].label+'</option>').join('')+'</select></div>'+
   '<div class="field"><label>Range</label><select class="sel" id="r-range">'+Object.keys(RANGES).map(k=>'<option value="'+k+'"'+(k===S.range?' selected':'')+'>'+RANGES[k].label+'</option>').join('')+'</select></div></div>',
   '<button class="btn gho" data-act="close-modal">Cancel</button><button class="btn pri" data-act="run-report" data-v="custom">'+ic('sparkle')+'Generate</button>');
   break;
  case 'run-report':{const name=v==='custom'?($('#r-name')?$('#r-name').value:'Custom report'):v;
   closeModal();exportCurrent();toast('Report generated',name+' is ready','ok');break;}
  case 'upgrade':go('billing');break;
 }
});
/* change / input handlers */
document.addEventListener('change',function(e){
 const el=e.target,k=el.getAttribute('data-k');if(!k)return;
 if(k==='dim'){S.dim=el.value;save();render();toast('Dimension switched',DIMS[S.dim].label+' recalculated','inf');}
 else if(k==='gran'){S.gran=el.value;save();render();}
 else if(k==='per'){S.table.per=+el.value;S.table.page=1;save();updateTable();}
 else if(k==='netmode'){NET.mode=el.value;saveNet();toast('Data source',NET.mode==='remote'?'Real fetch via apiRequest':'Mock adapter with injectable failures','inf');}
 else if(k==='netfail'){NET.failMode=el.value;saveNet();}
 else if(k==='netlatency'){NET.latency=clamp(+el.value||0,0,15000);saveNet();}
 else if(k==='nettimeout'){NET.timeout=clamp(+el.value||8000,100,60000);saveNet();}
 else if(k==='netbase'){NET.baseURL=el.value;saveNet();}
 else if(el.hasAttribute('data-set')){S.settings[el.getAttribute('data-set')]=el.value;save();}
});
document.addEventListener('input',function(e){
 const el=e.target,k=el.getAttribute('data-k');if(!k)return;
 if(k==='tq'){
  S.table.q=el.value;S.table.page=1;S.table.open=null;save();
  const hint=$('#tqHint');if(hint)hint.textContent='debouncing 500ms…';
  applyTableSearch();
 }
 else if(k==='glob'&&false){/* reserved */}
 else if(k==='cmdq'){renderCmd(el.value);}
 else if(el.hasAttribute('data-set')){S.settings[el.getAttribute('data-set')]=el.value;save();}
});
document.addEventListener('keydown',function(e){
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#cmd').classList.contains('show')?closeCmd():renderCmd('');return;}
 if(e.key==='Escape'){closeModal();closeCmd();$('#notifPop').classList.remove('show');$('#app').classList.remove('mobile-open');return;}
 if($('#cmd').classList.contains('show')){
  if(e.key==='ArrowDown'){e.preventDefault();cmdMove(1);}
  else if(e.key==='ArrowUp'){e.preventDefault();cmdMove(-1);}
  else if(e.key==='Enter'){const it=CMD_ITEMS[CMD_IDX];if(it){closeCmd();it.run();}}
 }
 if(e.key==='Enter'&&e.target.id==='globQ'){S.table.q=e.target.value;S.table.status='All';S.table.page=1;save();go('users');toast('Search',e.target.value||'all users','inf');}
});
document.addEventListener('click',function(e){
 if(!e.target.closest('#cmd')&&!e.target.closest('[data-act="cmd-open"]'))closeCmd();
 const pop=$('#notifPop');if(pop&&!e.target.closest('#notifPop')&&!e.target.closest('[data-act="notif-toggle"]'))pop.classList.remove('show');
 if($('#app').classList.contains('mobile-open')&&!e.target.closest('.side')&&!e.target.closest('[data-act="mobile-menu"]'))
  $('#app').classList.remove('mobile-open');
});
$('#overlay').addEventListener('click',function(e){if(e.target===this)closeModal();});
window.addEventListener('resize',window.NS.throttle(function(){
 CHARTS.forEach(c=>{try{lineChart(c.id,Object.assign({},c.opts,{height:c.opts.height}));}catch(e){}});
 const sc=$('#tableScroll');if(sc&&sc.__vt)sc.__vt.refresh();
},200));

/* ── Boot ───────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════
   7 · Infrastructure wiring — modules 1–5
   Replaces the old boot / route / table functions as whole units.
   ══════════════════════════════════════════════════════════════ */
const NS=window.NS;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ── M1 · Data source adapter ───────────────────────────────────
   mock   : deterministic local data, but with real latency + injectable
            failures so loading / error / retry are demonstrable.
   remote : a genuine fetch through apiRequest().
   Swapping the backend now means changing one config value, not the views.
   ────────────────────────────────────────────────────────────── */
const NET_KEY='northstar.net.v1',SIGNOUT_KEY='northstar.signedOut';
function defaultNet(){
 return {mode:'mock',baseURL:'/api/v1',latency:650,timeout:8000,failMode:'none',forceFail:false,failNext:false};
}
let NET=(function(){try{return Object.assign(defaultNet(),JSON.parse(localStorage.getItem(NET_KEY)||'{}'));}catch(e){return defaultNet();}})();
function saveNet(){try{localStorage.setItem(NET_KEY,JSON.stringify(NET));}catch(e){}}
function simulatedError(mode,url){
 const H=NS.HTTP_MESSAGES;
 switch(mode){
  case '401':return new NS.ApiError('UNAUTHORIZED',H[401],401,url,false,{});
  case '403':return new NS.ApiError('FORBIDDEN',H[403],403,url,false,{});
  case '500':return new NS.ApiError('SERVER_ERROR',H[500],500,url,true,{});
  case 'timeout':return new NS.ApiError('TIMEOUT','Request timed out after '+NET.timeout+'ms. Check your connection and retry.',0,url,true,{timeout:NET.timeout});
  case 'network':return new NS.ApiError('NETWORK','Network unreachable — you appear to be offline, or the server refused the connection.',0,url,true,{});
  default:return new NS.ApiError('SERVER_ERROR',H[500],500,url,true,{});
 }
}
const DataSource={
 mode(){return NET.mode;},
 async fetch(resource,params){
  const q=params?Object.keys(params).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(params[k])).join('&'):'';
  const url=NET.baseURL.replace(/\/$/,'')+'/'+resource+(q?'?'+q:'');
  if(NET.mode==='remote'){
   const r=await NS.apiRequest(url,{timeout:NET.timeout,method:'GET',headers:{'X-Client':'northstar-dashboard'}});
   return r.data;
  }
  if(NET.latency>0)await sleep(Math.min(NET.latency,15000));
  const shouldFail=NET.forceFail||NET.failNext;
  if(NET.failNext){NET.failNext=false;saveNet();}
  if(shouldFail)throw simulatedError(NET.failMode==='none'?'500':NET.failMode,url);
  return {ok:true,resource:resource,rows:S.users.length,servedAt:new Date().toISOString()};
 }
};

/* ── M2 · Route-level loading / error / retry ────────────────── */
let LOAD_SEQ=0;
function loadRouteData(page,meta){
 const verdict=NS.Router.guard(page);
 if(!verdict.allow){NS.Router.navigate(verdict.redirect,{replace:true});return;}
 const seq=++LOAD_SEQ,host=$('#wrap');
 if(!host)return;
 NS.clearState(host);
 NS.showLoading(host,
  page==='users'?'Loading accounts from the data source…':'Loading workspace metrics…',
  page==='users'?'table':'chart');
 DataSource.fetch(page,{dim:S.dim,range:S.range,gran:S.gran}).then(()=>{
  if(seq!==LOAD_SEQ)return;
  NS.hideLoading(host);
  render();
  if(meta&&meta.guarded)toast('Redirected by route guard','You were sent to a page your session can open','inf');
 }).catch(err=>{
  if(seq!==LOAD_SEQ)return;
  NS.hideLoading(host);
  if(err&&err.kind==='UNAUTHORIZED'){
   NS.Auth.clear();try{localStorage.setItem(SIGNOUT_KEY,'1');}catch(e){}
   toast('Session expired','Sign in again to continue','err');go('login');return;
  }
  NS.showError(host,err,()=>loadRouteData(page,null),{dismiss:true});
 });
}
function onRouteChange(page,meta){
 if(page==='login'){render();return;}
 loadRouteData(page,meta||{});
}
function refreshCurrentView(){
 const p=parseRoute();
 if(p==='login'){render();return;}
 loadRouteData(p,{manual:true});
}

/* ── M3 · Auth view + guard wiring ───────────────────────────── */
VIEWS.login=function(){
 return '<div class="login-shell"><div class="login-card">'+
  '<div class="brandline"><span class="mark">'+ic('zap')+'</span><div>'+
  '<div style="font-size:15px;font-weight:750;letter-spacing:-.01em">Northstar</div>'+
  '<div style="font-size:9px;letter-spacing:.16em;color:var(--txt-3);text-transform:uppercase">Product analytics</div></div></div>'+
  '<img class="login-shot" src="images/team-table.jpg" alt="The team working around a table">'+
  '<h1>Your workspace is still here</h1>'+
  '<p class="sub">The Nov 3 cohort is waiting where you left it. Sign in to pick it back up.</p>'+
  '<div class="field"><label>Work email</label><input class="inp" id="loginEmail" type="email" value="olivia@northstarlabs.io" autocomplete="username"></div>'+
  '<div class="field"><label>Password</label><input class="inp" id="loginPassword" type="password" value="demo-password" autocomplete="current-password"></div>'+
  '<div class="login-err" id="loginErr"></div>'+
  '<button class="btn pri" data-act="login-submit">'+ic('arrow-right')+'Sign in</button>'+
  '<div class="login-note"><b>Demo session.</b> Any non-empty credentials issue a local token in <code>localStorage.token</code>. '+
  'Sign out from Settings to verify that <code>/dashboard</code> is unreachable without it. '+
  'This is a front-end guard — real authorization must also be enforced on the server.</div>'+
  '</div></div>';
};
function doLogin(){
 const email=$('#loginEmail')?$('#loginEmail').value.trim():'',pw=$('#loginPassword')?$('#loginPassword').value.trim():'';
 if(!email||!pw){const e=$('#loginErr');if(e)e.textContent='Email and password are required.';return;}
 NS.Auth.issue(email.split('@')[0]||'demo');
 try{localStorage.removeItem(SIGNOUT_KEY);}catch(e){}
 toast('Signed in','Session token issued and stored','ok');
 go('dashboard');
}
function signOut(){
 NS.Auth.clear();try{localStorage.setItem(SIGNOUT_KEY,'1');}catch(e){}
 toast('Signed out','Protected routes are now locked','inf');
 go('login');
}

function parseRoute(){
 const p=NS.Router.current();
 return VIEWS[p]?p:'dashboard';
}
function go(p){
 if(!VIEWS[p])p='dashboard';
 NS.Router.navigate(p);
}
function render(){
 const page=parseRoute();CHARTS=[];
 const auth=page==='login';
 $('#app').classList.toggle('auth-mode',auth);
 $('#app').classList.toggle('collapsed',!auth&&S.collapsed&&window.innerWidth>960);
 renderSide(auth?'dashboard':page);renderTop(auth?'dashboard':page);
 $('#wrap').innerHTML=(VIEWS[page]||VIEWS.dashboard)();
 $('#view').scrollTop=0;
 if(auth){stopRealtime();return;}
 mountEffects();rollKPIs();
 const hv=animateHero();
 PREV.kpi=kpiValues().map(k=>k.v);
 if(hv!=null)PREV.hero=hv;
 if(page==='realtime'||page==='dashboard')startRealtime();else stopRealtime();
}

/* ── M4 · Large dataset + virtual table ──────────────────────── */
const VIRTUAL_MIN=200;
function isVirtual(){return S.users.length>=VIRTUAL_MIN;}
function expandUsers(n){
 const base=seedUsers(),FIRST=['Olivia','Marcus','Sofia','Ethan','Priya','Noah','Ava','Liam','Isabella','Mateo',
  'Chloe','Jonas','Amara','Felix','Nora','Kai','Elena','Ravi','Mila','Theo','Zoe','Owen','Layla','Hugo','Ines','Ezra','Freya','Dante'],
  LAST=['Bennett','Chen','Alvarez','Wright','Nair','Fischer','Thompson','Okafor','Rossi','Silva','Dubois','Weber',
  'Kowalski','Novak','Haddad','Park','Costa','Lindgren','Moreau','Ibrahim'];
 const out=new Array(n);
 for(let i=0;i<n;i++){
  const nm=FIRST[i%FIRST.length]+' '+LAST[Math.floor(i/FIRST.length)%LAST.length];
  out[i]={id:'U-'+String(300000+i),name:nm,
   email:nm.toLowerCase().replace(/\s+/g,'.')+i+'@'+DOMAINS[i%DOMAINS.length],
   initials:(nm[0]+nm.split(' ')[1][0]).toUpperCase(),g:i%GRADS.length,
   status:(i%11===0?'Churned':i%7===0?'Pending':'Active'),
   plan:PLANS[i%PLANS.length],role:ROLES[i%ROLES.length],
   mrr:Math.round(29+noise(i,77)*940),country:COUNTRIES[i%COUNTRIES.length],
   last:Math.round(noise(i,88)*8000),sessions:Math.round(4+noise(i,99)*180),
   joined:'202'+String(3+i%4)+'-'+String(1+i%12).padStart(2,'0')+'-'+String(1+i%28).padStart(2,'0'),
   bars:Array.from({length:14},(_,j)=>Math.round(4+noise(i*17+j,29)*16)),note:''};
 }
 S.users=out;S.table.q='';S.table.status='All';S.table.page=1;S.table.sel=[];S.table.open=null;
 save();
}
function restoreUsers(){
 S.users=seedUsers();S.table.q='';S.table.status='All';S.table.page=1;S.table.sel=[];S.table.open=null;
 save();
}
function userRowHTML(u,virtual){
 const t=S.table;
 let h='<tr class="'+(t.sel.indexOf(u.id)>=0?'sel':'')+'" data-uid="'+esc(u.id)+'">'+
  '<td><input type="checkbox" data-act="sel-one" data-v="'+u.id+'" '+(t.sel.indexOf(u.id)>=0?'checked':'')+'></td>'+
  '<td><div class="u-cell">'+avatar(u)+'<div><b data-act="user-open" data-v="'+u.id+'">'+esc(u.name)+'</b>'+
  '<small>'+esc(u.role)+' · '+esc(u.id)+'</small></div></div></td>'+
  '<td>'+esc(u.email)+'</td><td><span class="tag '+u.status+'"><span class="bdot"></span>'+u.status+'</span></td>'+
  '<td><span class="pill n">'+esc(u.plan)+'</span></td><td class="mono" style="color:var(--txt)">'+money(u.mrr)+'</td>'+
  '<td>'+timeAgo(u.last)+'</td><td><div class="rowacts" style="justify-content:flex-end">'+
  '<button class="mini-btn" data-act="user-edit" data-v="'+u.id+'" title="Edit">'+ic('edit')+'</button>'+
  '<button class="mini-btn del" data-act="user-del" data-v="'+u.id+'" title="Delete">'+ic('trash')+'</button></div></td></tr>';
 if(!virtual&&t.open===u.id)h+='<tr class="detail-row"><td colspan="8"><div class="detail-grid">'+
  '<div class="di"><span>Country</span><b>'+esc(u.country)+'</b></div>'+
  '<div class="di"><span>Sessions · 30d</span><b>'+num(u.sessions)+'</b></div>'+
  '<div class="di"><span>Joined</span><b>'+esc(u.joined)+'</b></div>'+
  '<div class="di"><span>Lifetime value</span><b>'+money(u.mrr*14)+'</b></div>'+
  '</div><div style="margin-top:11px;display:flex;align-items:center;gap:10px"><span class="eyebrow">Engagement · 14d</span>'+
  '<span class="inline-bars">'+u.bars.map(b=>'<i style="height:'+b+'px"></i>').join('')+'</span>'+
  '<button class="btn sm gho" data-act="user-edit" data-v="'+u.id+'" style="margin-left:auto">'+ic('edit')+'Edit profile</button></div></td></tr>';
 return h;
}
function tableHeadHTML(rows){
 const t=S.table;
 return '<tr><th style="width:34px"><input type="checkbox" data-act="sel-all" '+
  (rows.length&&rows.every(r=>t.sel.indexOf(r.id)>=0)?'checked':'')+'></th>'+thCell('name','User')+
  thCell('email','Email')+thCell('status','Status')+thCell('plan','Plan')+thCell('mrr','MRR')+
  thCell('last','Last active')+'<th style="text-align:right">Actions</th></tr>';
}
function tableBodyHTML(){
 const t=S.table,list=tableRows(),virtual=isVirtual();
 if(virtual){
  return '<div class="table-scroll vt" id="tableScroll"><table><thead>'+tableHeadHTML(list.slice(0,12))+
   '</thead><tbody id="vtBody"></tbody></table></div>';
 }
 const pages=Math.max(1,Math.ceil(list.length/t.per)),page=clamp(t.page,1,pages);
 t.page=page;const start=(page-1)*t.per,rows=list.slice(start,start+t.per);
 let h='<div class="table-scroll"><table><thead>'+tableHeadHTML(rows)+'</thead><tbody>';
 if(!rows.length)h+='<tr><td colspan="8"><div class="empty">'+ic('search')+
  '<b>No users match those filters</b><p>Try a different keyword or clear the status filter.</p></div></td></tr>';
 rows.forEach(u=>{h+=userRowHTML(u,false);});
 return h+'</tbody></table></div>';
}
function tableFootHTML(){
 const t=S.table,list=tableRows(),counts=tableCounts();
 if(isVirtual()){
  return '<div class="tfoot"><span class="vt-badge">'+ic('zap')+'VIRTUALIZED</span>'+
   '<span>Only <b style="color:var(--txt)" id="vtDom">0</b> DOM rows mounted of <b style="color:var(--txt)">'+num(list.length)+
   '</b> — scroll to stream the rest</span><span class="muted">· '+counts.Active+' active · '+counts.Pending+
   ' pending · '+counts.Churned+' churned</span></div>';
 }
 const pages=Math.max(1,Math.ceil(list.length/t.per)),page=clamp(t.page,1,pages),start=(page-1)*t.per;
 let h='<div class="tfoot"><span>Showing <b style="color:var(--txt)">'+(list.length?start+1:0)+'–'+
  Math.min(start+t.per,list.length)+'</b> of <b style="color:var(--txt)">'+list.length+'</b> users</span>'+
  '<span class="muted">· '+counts.Active+' active · '+counts.Pending+' pending · '+counts.Churned+' churned</span>'+
  '<div class="pages"><button class="pg" data-act="page" data-v="'+(page-1)+'" '+(page===1?'disabled':'')+'>'+ic('chev-left','xs')+'</button>';
 const from=Math.max(1,Math.min(page-2,pages-4)),to=Math.min(pages,from+4);
 for(let p=from;p<=to;p++)h+='<button class="pg '+(p===page?'on':'')+'" data-act="page" data-v="'+p+'">'+p+'</button>';
 return h+'<button class="pg" data-act="page" data-v="'+(page+1)+'" '+(page===pages?'disabled':'')+'>'+ic('chev-right','xs')+'</button></div></div>';
}
function tableToolsHTML(){
 const t=S.table,counts=tableCounts(),virt=isVirtual();
 return '<div class="table-tools"><div class="tsearch">'+ic('search')+
  '<input id="tSearch" class="inp" style="height:33px" placeholder="Search name, email, plan, country…" value="'+esc(t.q)+'" data-k="tq"></div>'+
  '<span class="muted" id="tqHint" style="font-size:10px;min-width:0;white-space:nowrap"></span>'+
  '<div class="chips">'+['All','Active','Pending','Churned'].map(s=>'<button class="chip '+(t.status===s?'on':'')+
   '" data-act="chip" data-v="'+s+'">'+s+'<span class="n">'+num(counts[s])+'</span></button>').join('')+'</div>'+
  '<div style="flex:1"></div>'+
  (virt?'<span class="vt-badge">'+ic('zap')+num(S.users.length)+' ROWS</span>':
   '<select class="sel" data-k="per" style="height:33px;width:104px">'+
   [8,12,20].map(n=>'<option value="'+n+'"'+(t.per===n?' selected':'')+'>'+n+' / page</option>').join('')+'</select>')+
  exportBtn('')+'<button class="btn pri" data-act="user-add">'+ic('user-plus')+'<span>Add user</span></button></div>';
}
function tableCardInner(){
 return '<div id="tableTools">'+tableToolsHTML()+'</div><div id="bulkBar">'+bulkHTML()+'</div>'+
  '<div id="tableBody">'+tableBodyHTML()+'</div><div id="tableFoot">'+tableFootHTML()+'</div>';
}
function updateTable(soft){
 const host=$('#tableCard');if(!host)return;
 const scroll=$('#tableScroll');
 if(isVirtual()&&scroll&&scroll.__vt){
  const tools=$('#tableTools');if(tools)tools.innerHTML=tableToolsHTML();
  const bulk=$('#bulkBar');if(bulk)bulk.innerHTML=bulkHTML();
  const foot=$('#tableFoot');if(foot)foot.innerHTML=tableFootHTML();
  scroll.__vt.refresh();return;
 }
 if(soft&&$('#tableBody')){
  $('#tableBody').innerHTML=tableBodyHTML();
  $('#tableFoot').innerHTML=tableFootHTML();
  $('#bulkBar').innerHTML=bulkHTML();
  const tools=$('#tableTools');if(tools)tools.innerHTML=tableToolsHTML();
  mountEffects();return;
 }
 const a=document.activeElement,id=a&&a.id,pos=a&&a.selectionStart;
 host.innerHTML=tableCardInner();mountEffects();
 if(id){const n=document.getElementById(id);if(n){n.focus();if(pos!=null&&n.setSelectionRange)try{n.setSelectionRange(pos,pos);}catch(e){}}}
}
function updateVtFoot(vt){
 const el=$('#vtDom');if(el)el.textContent=String(Math.max(0,vt.lastEnd-vt.lastStart));
}
function mountVirtual(){
 const scroll=$('#tableScroll'),body=$('#vtBody');
 if(!scroll||!body)return null;
 const vt=NS.VirtualTable.mount(scroll,body,{
  getRows:()=>tableRows(),renderRow:u=>userRowHTML(u,true),rowHeight:56,overscan:6,cols:8});
 const original=vt.paint.bind(vt);
 vt.paint=function(){original();updateVtFoot(vt);};
 vt.refresh();
 return vt;
}
function mountEffects(){
 CHARTS.forEach(c=>{try{lineChart(c.id,c.opts);}catch(e){console.warn('chart',c.id,e.message);}});
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  $$('[data-w]').forEach(el=>{el.style.width=el.getAttribute('data-w')+'%';});
  $$('.dseg').forEach(el=>{el.style.strokeDasharray=el.getAttribute('data-dash');});
 }));
 mountVirtual();
}

/* ── M5 · debounced search + throttled resize ────────────────── */
const applyTableSearch=NS.debounce(function(){
 const hint=$('#tqHint');if(hint)hint.textContent='';
 updateTable(true);
},500);

/* ── Settings · network simulation + session cards ───────────── */
VIEWS.settings=function(){
 const st=S.settings,tg=st.toggles;
 const trow=(k,title,sub)=>'<div class="toggle-row"><div class="tx"><b>'+title+'</b><small>'+sub+'</small></div>'+
  '<button class="switch '+(tg[k]?'on':'')+'" data-act="toggle" data-v="'+k+'" aria-label="'+title+'"></button></div>';
 const field=(label,inner)=>'<div class="field"><label>'+label+'</label>'+inner+'</div>';
 const opt=(list,val)=>list.map(x=>'<option value="'+x[0]+'"'+(val===x[0]?' selected':'')+'>'+x[1]+'</option>').join('');
 const netCard='<div class="card">'+cardHead('Data source & network simulation','modules 1 · 2 · 5')+
  '<div class="card-b"><div class="sim-grid">'+
  field('Source','<select class="sel" data-k="netmode">'+opt([
   ['mock','Mock adapter (simulated)'],['remote','Remote API (real fetch)']],NET.mode)+'</select>')+
  field('Simulated failure','<select class="sel" data-k="netfail">'+opt([
   ['none','None (success)'],['401','401 Unauthorized'],['403','403 Forbidden'],
   ['500','500 Server error'],['timeout','Timeout / abort'],['network','Network offline']],NET.failMode)+'</select>')+
  field('Mock latency (ms)','<input class="inp" type="number" min="0" max="15000" step="100" data-k="netlatency" value="'+NET.latency+'">')+
  field('Request timeout (ms)','<input class="inp" type="number" min="100" max="60000" step="100" data-k="nettimeout" value="'+NET.timeout+'">')+
  '<div class="field full">'+'<label>Base URL (remote mode)</label><input class="inp" data-k="netbase" value="'+esc(NET.baseURL)+'"></div>'+
  '</div><div class="sim-row">'+
  '<button class="switch '+(NET.forceFail?'on':'')+'" data-act="sim-force" aria-label="Fail every request"></button>'+
  '<span style="font-size:11.5px">Fail every request</span>'+
  '<button class="btn sm gho" data-act="sim-next">'+ic('zap')+'Fail next request</button>'+
  '<button class="btn sm pri" data-act="sim-reload">'+ic('refresh')+'Reload view</button></div>'+
  '<div class="sim-meta">apiRequest(url,{timeout:8000}) → AbortController · Bearer token from localStorage · '+
  'typed ApiError: TIMEOUT / NETWORK / ABORTED / UNAUTHORIZED / FORBIDDEN / SERVER_ERROR / HTTP_ERROR / PARSE<br>'+
  'Remote mode issues a real fetch. Serving this file over file:// cannot reach cross-origin APIs — use a local HTTP server.</div>'+
  '</div></div>';
 const sessionCard='<div class="card">'+cardHead('Session & route guard','module 3')+'<div class="card-b">'+
  '<div class="session-row"><div><b>Authenticated</b><br><small class="muted">Token stored in localStorage</small></div>'+
  '<span class="session-code">'+esc(NS.Auth.get()||'— no token —')+'</span></div>'+
  '<div class="divider"></div><div class="kv"><span>Protected views</span><b>'+NS.Router.PROTECTED.length+'</b></div>'+
  '<div class="kv"><span>Routing mode</span><b>'+(NS.Router.historyMode?'History API':'hash fallback (file://)')+'</b></div>'+
  '<div class="divider"></div>'+
  '<button class="btn danger" data-act="sign-out">'+ic('arrow-right')+'Sign out</button>'+
  '<p class="muted" style="font-size:10.5px;margin-top:10px;line-height:1.65">After signing out, try opening /dashboard directly — the guard redirects to /login. '+
  'Signing in again while on /login sends you straight to /dashboard. A front-end guard improves UX; the server must still authorize every request.</p>'+
  '</div></div>';
 return pageHead('Settings','Workspace, notifications, appearance and data controls.',
   '<button class="btn pri" data-act="save-settings">'+ic('save')+'<span>Save changes</span></button>')+
  '<div class="set-grid"><div class="card">'+cardHead('Workspace','general')+'<div class="card-b"><div class="form-grid">'+
   '<div class="field"><label>Workspace name</label><input class="inp" data-set="workspace" value="'+esc(st.workspace)+'"></div>'+
   '<div class="field"><label>Timezone</label><select class="sel" data-set="timezone">'+
    ['(UTC−08:00) Pacific Time','(UTC−05:00) Eastern Time','(UTC+00:00) UTC','(UTC+01:00) Central Europe','(UTC+08:00) China Standard Time']
    .map(x=>'<option'+(x===st.timezone?' selected':'')+'>'+x+'</option>').join('')+'</select></div>'+
   '<div class="field"><label>Currency</label><select class="sel" data-set="currency">'+
    ['USD — US Dollar','EUR — Euro','GBP — British Pound','CNY — Chinese Yuan'].map(x=>'<option'+(x===st.currency?' selected':'')+'>'+x+'</option>').join('')+'</select></div>'+
   '<div class="field"><label>Language</label><select class="sel" data-set="language">'+
    ['English (US)','English (UK)','Deutsch','Français','简体中文'].map(x=>'<option'+(x===st.language?' selected':'')+'>'+x+'</option>').join('')+'</select></div>'+
   '<div class="field full"><label>Data refresh cadence</label><select class="sel" data-set="refresh">'+
    ['Real-time','Every 1 minute','Every 5 minutes','Every 15 minutes','Hourly'].map(x=>'<option'+(x===st.refresh?' selected':'')+'>'+x+'</option>').join('')+'</select></div>'+
   '</div></div></div>'+
  '<div class="card">'+cardHead('Appearance','accent & density')+'<div class="card-b">'+
   '<div class="eyebrow" style="margin-bottom:10px">Accent color</div><div class="swatches">'+
   ACCENTS.map(a=>'<button class="sw '+(S.accent===a.id?'on':'')+'" data-act="accent" data-v="'+a.id+'" title="'+a.name+'" style="background:linear-gradient(135deg,'+a.c1+','+a.c2+')"></button>').join('')+
   '</div><div class="divider"></div>'+
   '<div class="kv"><span>Theme</span><b>Dark (system default)</b></div>'+
   '<div class="kv"><span>Card style</span><b>Glassmorphism</b></div>'+
   '<div class="kv"><span>Density</span><b>Comfortable</b></div>'+
   '<div class="divider"></div><p class="muted" style="font-size:10.5px">Accent changes propagate to every chart, progress bar and heatmap instantly and persist across reloads.</p>'+
   '</div></div></div>'+
  '<div class="set-grid"><div class="card">'+cardHead('Notifications','delivery preferences')+'<div class="card-b">'+
   trow('email','Email digests','Daily summary of key metric movements')+
   trow('weekly','Weekly report','Monday 08:00 executive summary')+
   trow('anomaly','Anomaly alerts','Push when a metric leaves its expected band')+
   trow('product','Product updates','New features and changelog notes')+
   trow('beta','Beta features','Early access to experimental analytics')+
   '</div></div>'+
   '<div><div class="card">'+cardHead('API access','developer')+'<div class="card-b">'+
   '<div class="eyebrow" style="margin-bottom:8px">Live secret key</div><div class="apikey"><code>'+esc(st.apiKey)+'</code>'+
   '<button class="btn gho" data-act="copy-key">'+ic('copy')+'Copy</button></div>'+
   '<p class="muted" style="font-size:10.5px;margin-top:9px">Treat this key like a password. Rotate it every 90 days.</p>'+
   '<div class="divider"></div><div class="kv"><span>Environment</span><b>Production</b></div>'+
   '<div class="kv"><span>Last rotated</span><b>Oct 18, 2026</b></div></div></div>'+
   '<div class="card danger-zone" style="margin-top:14px">'+cardHead('Danger zone','irreversible actions')+
   '<div class="card-b"><div class="toggle-row" style="border:0"><div class="tx"><b>Reset demo workspace</b>'+
   '<small>Restores all users, settings, notifications and filters to the seeded state.</small></div>'+
   '<button class="btn danger" data-act="reset-data">'+ic('rotate')+'Reset data</button></div></div></div></div></div>'+
  '<div style="height:14px"></div><div class="set-grid">'+netCard+sessionCard+'</div>';
};

/* ── Users · large-dataset switch ────────────────────────────── */
VIEWS.users=function(){
 const t=S.table,counts={Active:0,Pending:0,Churned:0};S.users.forEach(u=>counts[u.status]++);
 const virt=isVirtual();
 return pageHead('Users','Manage accounts, roles, plans and lifecycle status.',
   '<span class="pill b">'+ic('users')+num(S.users.length)+' accounts</span>'+
   (virt?'<button class="btn gho" data-act="restore-rows">'+ic('rotate')+'Restore 28 rows</button>':
    '<button class="btn gho" data-act="load-rows" data-v="5000">'+ic('layers')+'Load 5,000 rows</button>')+
   exportBtn('Export all'))+
  '<div class="kpis" style="margin-bottom:16px">'+
   [['Total accounts',num(S.users.length),'users','users'],['Active',num(counts.Active),'Active','check-circle'],
    ['Pending review',num(counts.Pending),'Pending','clock'],['Monthly recurring',money(sum(S.users.map(u=>u.mrr))),'MRR','wallet']]
   .map((x,i)=>'<div class="card kpi" style="cursor:default"><div class="top"><span class="nm">'+x[0]+'</span>'+ic(x[3],'s')+'</div>'+
    '<div class="num" style="font-size:23px">'+x[1]+'</div><div class="foot"><span class="delta good">'+ic('arrow-ur')+'Live</span>'+
    '<span>updated just now</span></div></div>').join('')+'</div>'+
   usersTableCard();
};

function save(){
 try{localStorage.setItem(KEY,JSON.stringify({
  dim:S.dim,range:S.range,gran:S.gran,compare:S.compare,collapsed:S.collapsed,accent:S.accent,
  /* 5,000-row demo datasets stay in memory only — never bloat localStorage */
  users:S.users.length>500?seedUsers():S.users,
  table:S.table,settings:S.settings,notifications:S.notifications,reports:S.reports}));}catch(e){}
}

/* ── Boot ──────────────────────────────────────────────────────
   A fresh visitor gets a demo session so the dashboard is still the
   landing page. Signing out sets a flag, so a reload stays signed out
   and the guard can be demonstrated by opening /dashboard directly.
   ────────────────────────────────────────────────────────────── */
if(!NS.Auth.isAuthed()){
 let signedOut=false;try{signedOut=localStorage.getItem(SIGNOUT_KEY)==='1';}catch(e){}
 if(!signedOut)NS.Auth.issue('demo');
}
NS.Router.init({onChange:onRouteChange});
if(!location.hash&&!NS.Router.historyMode&&window.history&&history.replaceState){
 try{history.replaceState(null,'','#/'+NS.Router.current());}catch(e){}
}
NS.Router._fire(true);

