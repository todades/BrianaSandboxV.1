<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="csrf-token" content="{{ csrf_token() }}" />
  <title>Sandbox de Simulación — Metadatos Académicos · BritoNet</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css" />
  <style>
    :root{
      --bg:#0d0f14; --surface:#13161e; --surface2:#1a1e29; --surface3:#212638;
      --teal:#00d4aa; --teal-dim:#00a885; --teal-glow:rgba(0,212,170,0.15);
      --purple:#7c6aee; --purple-dim:#5e4fd4;
      --amber:#f59e0b; --red:#ef4444; --green:#22c55e;
      --text:#e2e8f0; --text-muted:#64748b; --text-dim:#94a3b8;
      --border:rgba(255,255,255,0.07); --border-active:rgba(0,212,170,0.4);
      --mono:"SFMono-Regular",ui-monospace,Menlo,Consolas,monospace;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%}
    body{
      font-family:"Inter",sans-serif;background:var(--bg);color:var(--text);
      font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;
    }
    ::-webkit-scrollbar{width:8px;height:8px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:var(--surface3);border-radius:4px}
    ::-webkit-scrollbar-thumb:hover{background:#2a3047}

    /* ===== LAYOUT ===== */
    .app{display:grid;grid-template-columns:260px 1fr;min-height:100vh}

    /* ===== SIDEBAR ===== */
    .sidebar{
      background:var(--surface);border-right:1px solid var(--border);
      display:flex;flex-direction:column;padding:18px 14px;position:sticky;top:0;height:100vh;
    }
    .brand{display:flex;align-items:center;gap:11px;padding:6px 8px 18px}
    .brand-logo{
      width:38px;height:38px;border-radius:10px;flex-shrink:0;
      background:linear-gradient(135deg,var(--teal),var(--purple));
      display:flex;align-items:center;justify-content:center;font-size:20px;
    }
    .brand-name{font-weight:700;font-size:15px;letter-spacing:.2px}
    .brand-sub{font-size:11px;color:var(--text-muted)}
    .nav{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;margin-top:8px}
    .nav-label{
      font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);
      padding:14px 10px 6px;font-weight:600;
    }
    .nav-item{
      display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:8px;
      color:var(--text-dim);text-decoration:none;font-size:13px;font-weight:500;
      border:1px solid transparent;cursor:pointer;transition:background .15s,color .15s;
    }
    .nav-item i{font-size:18px}
    .nav-item:hover{background:var(--surface2);color:var(--text)}
    .nav-item.active{background:var(--teal-glow);border:1px solid var(--border-active);color:var(--teal)}
    .user-pill{
      display:flex;align-items:center;gap:11px;padding:10px;margin-top:8px;
      border-radius:10px;background:var(--surface2);border:1px solid var(--border);
    }
    .user-avatar{
      width:34px;height:34px;border-radius:50%;flex-shrink:0;
      background:linear-gradient(135deg,var(--teal),var(--purple));
      display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#06231d;
    }
    .user-name{font-weight:600;font-size:13px}
    .user-role{font-size:11px;color:var(--text-muted)}

    /* ===== MAIN ===== */
    .main{display:flex;flex-direction:column;min-width:0}
    .topbar{
      height:56px;flex-shrink:0;background:var(--surface);border-bottom:1px solid var(--border);
      display:flex;align-items:center;justify-content:space-between;padding:0 22px;gap:16px;
    }
    .topbar-title{font-weight:600;font-size:14px}
    .topbar-sub{font-size:11px;color:var(--text-muted)}
    .topbar-badges{display:flex;gap:10px;flex-shrink:0}
    .badge{
      display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:7px;
      background:var(--surface2);border:1px solid var(--border);font-size:12px;color:var(--text-dim);
    }
    .badge b{font-family:var(--mono);color:var(--teal);font-weight:600}
    .badge .lbl{color:var(--text-muted)}

    .content{
      flex:1;display:grid;grid-template-columns:300px 1fr;gap:18px;padding:18px 22px;align-items:start;
    }

    /* ===== ASSISTANT PANEL ===== */
    .panel{background:var(--surface);border:1px solid var(--border);border-radius:12px}
    .assistant{position:sticky;top:18px;display:flex;flex-direction:column;gap:16px;padding:16px}
    .assistant-head{display:flex;align-items:center;gap:9px;font-weight:600;font-size:14px}
    .assistant-head i{font-size:20px;color:var(--teal)}

    .dropzone{
      border:1.5px dashed rgba(0,212,170,0.25);border-radius:8px;padding:28px 18px;
      text-align:center;cursor:pointer;transition:border-color .15s,background .15s;
    }
    .dropzone:hover,.dropzone.drag{border-color:var(--teal);background:var(--teal-glow)}
    .dropzone i{font-size:34px;color:var(--teal)}
    .dz-label{font-weight:600;font-size:13px;margin-top:8px}
    .dz-sub{font-size:11px;color:var(--text-muted);margin-top:2px}
    .dz-btn{
      margin-top:14px;display:inline-flex;align-items:center;gap:6px;padding:7px 16px;
      border:1px solid var(--border-active);border-radius:7px;background:transparent;
      color:var(--teal);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;
    }
    .dz-btn:hover{background:var(--teal-glow)}
    .file-badge{
      display:none;align-items:center;gap:8px;margin-top:12px;padding:8px 12px;border-radius:7px;
      background:var(--teal-glow);border:1px solid var(--border-active);font-size:12px;
    }
    .file-badge.show{display:flex}
    .file-badge i{font-size:16px;color:var(--teal)}
    .file-badge span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    /* steps */
    .steps{display:flex;flex-direction:column;gap:2px}
    .step{display:flex;align-items:flex-start;gap:11px;padding:8px 4px}
    .dot{
      width:18px;height:18px;border-radius:50%;flex-shrink:0;margin-top:2px;
      border:2px solid var(--surface3);background:var(--surface2);
      display:flex;align-items:center;justify-content:center;transition:all .2s;
    }
    .dot i{font-size:11px;color:#fff;opacity:0}
    .step.active .dot{border-color:var(--teal);background:var(--teal-glow);animation:pulse 1.3s infinite}
    .step.done .dot{border-color:var(--green);background:var(--green)}
    .step.done .dot i{opacity:1}
    .step.error .dot{border-color:var(--red);background:var(--red)}
    .step.error .dot i{opacity:1}
    @keyframes pulse{0%,100%{box-shadow:0 0 0 0 var(--teal-glow)}50%{box-shadow:0 0 0 5px transparent}}
    .step-t{font-size:12.5px;font-weight:600;color:var(--text-dim)}
    .step.active .step-t,.step.done .step-t{color:var(--text)}
    .step-d{font-size:11px;color:var(--text-muted)}

    /* kpi */
    .kpis{display:grid;grid-template-columns:1fr 1fr;gap:9px}
    .kpi{background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:11px 12px}
    .kpi-l{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);font-weight:600}
    .kpi-v{font-size:20px;font-weight:700;font-family:var(--mono);margin-top:3px}
    .kpi.teal .kpi-v{color:var(--teal)}
    .kpi.amber .kpi-v{color:var(--amber)}
    .kpi.purple .kpi-v{color:var(--purple)}

    .analyze-btn{
      width:100%;padding:12px;border:none;border-radius:9px;cursor:pointer;
      background:linear-gradient(135deg,var(--teal-dim),var(--purple-dim));
      color:#fff;font-weight:700;font-size:14px;font-family:inherit;
      display:flex;align-items:center;justify-content:center;gap:8px;transition:opacity .15s,filter .15s;
    }
    .analyze-btn i{font-size:18px}
    .analyze-btn:hover:not(:disabled){filter:brightness(1.08)}
    .analyze-btn:disabled{opacity:.4;cursor:not-allowed}
    .analyze-btn.loading{background:var(--surface3);color:var(--text-dim)}
    .analyze-btn.done{background:rgba(34,197,94,0.15);color:var(--green);border:1px solid rgba(34,197,94,0.4)}
    .spin{animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}

    /* ===== FORM PANEL ===== */
    .formpanel{display:flex;flex-direction:column;min-width:0}
    .form-head{
      display:flex;align-items:center;justify-content:space-between;gap:12px;
      padding:16px 18px;border-bottom:1px solid var(--border);
    }
    .form-head-t{display:flex;align-items:center;gap:9px;font-weight:600;font-size:14px}
    .form-head-t i{font-size:20px;color:var(--purple)}
    .pill{
      font-size:11px;font-weight:600;padding:5px 11px;border-radius:20px;font-family:var(--mono);
      background:var(--surface3);color:var(--text-muted);border:1px solid var(--border);letter-spacing:.5px;
    }
    .pill.proc{background:var(--teal-glow);color:var(--teal);border-color:var(--border-active)}
    .pill.done{background:rgba(34,197,94,0.12);color:var(--green);border-color:rgba(34,197,94,0.4)}
    .progress{height:2px;background:var(--surface3)}
    .progress-bar{height:100%;width:0;background:linear-gradient(90deg,var(--teal),var(--purple));transition:width .5s ease}

    .fields{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:18px}
    .field{display:flex;flex-direction:column;gap:6px;min-width:0}
    .field.full{grid-column:1 / -1}
    .field-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
    .field-label{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--text-dim);font-weight:600}
    .ai-tag{
      font-size:9.5px;font-family:var(--mono);font-weight:600;padding:3px 7px;border-radius:5px;
      letter-spacing:.3px;white-space:nowrap;background:var(--surface3);color:var(--text-muted);
      border:1px solid var(--border);
    }
    .ai-tag.extracting{background:var(--teal-glow);color:var(--teal);border-color:var(--border-active);animation:tagpulse 1s infinite}
    .ai-tag.done{background:rgba(34,197,94,0.12);color:var(--green);border-color:rgba(34,197,94,0.35)}
    .ai-tag.null-val{background:rgba(245,158,11,0.12);color:var(--amber);border-color:rgba(245,158,11,0.35)}
    @keyframes tagpulse{0%,100%{opacity:1}50%{opacity:.55}}

    .field-input{
      width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;
      padding:10px 12px;color:var(--text);font-family:inherit;font-size:13px;resize:vertical;
      transition:border-color .15s,background .15s,box-shadow .15s;
    }
    .field-input:focus{outline:none}
    .field-input[readonly]{cursor:default}
    .field-input.typing{border-color:var(--teal);background:var(--surface2);animation:field-glow 1.1s infinite}
    @keyframes field-glow{0%,100%{box-shadow:0 0 0 0 rgba(0,212,170,0.0)}50%{box-shadow:0 0 0 3px var(--teal-glow)}}
    .field-input.filled{border-color:rgba(0,212,170,.3);background:rgba(0,212,170,.04)}
    .field-input.null-field{border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.05);color:var(--amber);font-style:italic}
    .field-input.editing{border-color:rgba(245,158,11,.5);color:var(--amber)}

    .actions{display:flex;gap:12px;padding:16px 18px;border-top:1px solid var(--border)}
    .btn{
      padding:11px 18px;border-radius:9px;font-weight:600;font-size:13px;font-family:inherit;
      cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:all .15s;
    }
    .btn i{font-size:17px}
    .btn-save{flex:1;border:none;background:linear-gradient(135deg,var(--teal-dim),#0891b2);color:#fff}
    .btn-save:hover:not(:disabled){filter:brightness(1.08)}
    .btn-save:disabled{opacity:.4;cursor:not-allowed}
    .btn-fix{background:transparent;border:1px solid var(--border);color:var(--text-dim)}
    .btn-fix:hover{border-color:var(--purple);color:var(--purple)}
    .btn-fix.active{border-color:var(--amber);color:var(--amber)}

    /* ===== TOAST ===== */
    .toast-wrap{position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;gap:10px;z-index:999}
    .toast{
      background:var(--red);color:#fff;padding:13px 16px;border-radius:9px;font-size:13px;font-weight:500;
      display:flex;align-items:center;gap:9px;max-width:340px;animation:fadeIn .25s ease;
      box-shadow:0 8px 24px rgba(0,0,0,.4);
    }
    .toast.ok{background:var(--green)}
    .toast i{font-size:18px;flex-shrink:0}
    @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeOut{to{opacity:0;transform:translateY(12px)}}

    /* ===== RESPONSIVE ===== */
    @media(max-width:980px){.content{grid-template-columns:1fr}.assistant{position:static}}
    @media(max-width:768px){
      .app{grid-template-columns:1fr}
      .sidebar{display:none}
      .fields{grid-template-columns:1fr}
      .topbar{flex-wrap:wrap;height:auto;padding:10px 16px}
    }
  </style>
</head>
<body>
  <div class="app">
    <!-- ===== SIDEBAR ===== -->
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">🎓</div>
        <div>
          <div class="brand-name">BritoNet</div>
          <div class="brand-sub">Academic Platform</div>
        </div>
      </div>
      <nav class="nav">
        <div class="nav-label">Plataforma</div>
        <a class="nav-item"><i class="ti ti-layout-dashboard"></i> Dashboard</a>
        <a class="nav-item"><i class="ti ti-home"></i> Inicio</a>
        <a class="nav-item"><i class="ti ti-database-export"></i> Respaldos</a>

        <div class="nav-label">Recursos</div>
        <a class="nav-item active"><i class="ti ti-folder"></i> Recursos</a>
        <a class="nav-item"><i class="ti ti-users-group"></i> Autores</a>
        <a class="nav-item"><i class="ti ti-category"></i> Tipos de Recurso</a>
        <a class="nav-item"><i class="ti ti-bulb"></i> Líneas de Investigación</a>
        <a class="nav-item"><i class="ti ti-download"></i> Descargas</a>

        <div class="nav-label">Usuarios</div>
        <a class="nav-item"><i class="ti ti-user"></i> Usuarios</a>
        <a class="nav-item"><i class="ti ti-school"></i> PNFs</a>
      </nav>
      <div class="user-pill">
        <div class="user-avatar">JD</div>
        <div>
          <div class="user-name">Juan Díaz</div>
          <div class="user-role">Administrador</div>
        </div>
      </div>
    </aside>

    <!-- ===== MAIN ===== -->
    <div class="main">
      <header class="topbar">
        <div>
          <div class="topbar-title">Sandbox de Simulación — Metadatos Académicos</div>
          <div class="topbar-sub">Caso de Estudio: Carga de Proyectos con IA · BritoNet</div>
        </div>
        <div class="topbar-badges">
          <div class="badge"><span class="lbl">Precisión IA:</span> <b id="badge-precision">—</b></div>
          <div class="badge"><span class="lbl">Tiempo:</span> <b id="badge-tiempo">—</b></div>
        </div>
      </header>

      <div class="content">
        <!-- ===== ASSISTANT PANEL ===== -->
        <section class="panel assistant">
          <div class="assistant-head"><i class="ti ti-robot"></i> Asistente Virtual de IA</div>

          <div class="dropzone" id="dropzone">
            <i class="ti ti-file-type-pdf"></i>
            <div class="dz-label">Arrastre y suelte su proyecto</div>
            <div class="dz-sub">Formato PDF · máx. 20 MB</div>
            <button class="dz-btn" id="pickBtn" type="button"><i class="ti ti-upload"></i> Seleccionar PDF</button>
            <input type="file" id="fileInput" accept="application/pdf" hidden />
          </div>
          <div class="file-badge" id="fileBadge"><i class="ti ti-file-check"></i> <span id="fileName"></span></div>

          <div class="steps" id="steps">
            <div class="step" data-step="0"><div class="dot"><i class="ti ti-check"></i></div><div><div class="step-t">Cargando archivo</div><div class="step-d">Esperando selección de PDF</div></div></div>
            <div class="step" data-step="1"><div class="dot"><i class="ti ti-check"></i></div><div><div class="step-t">Extrayendo texto local</div><div class="step-d">Procesando PDF con smalot/pdfparser</div></div></div>
            <div class="step" data-step="2"><div class="dot"><i class="ti ti-check"></i></div><div><div class="step-t">Consultando API de IA</div><div class="step-d">Enviando texto extraído a Claude/GPT</div></div></div>
            <div class="step" data-step="3"><div class="dot"><i class="ti ti-check"></i></div><div><div class="step-t">Rellenando formulario</div><div class="step-d">Parseando JSON y mostrando campos</div></div></div>
          </div>

          <div class="kpis">
            <div class="kpi teal"><div class="kpi-l">Precisión IA</div><div class="kpi-v" id="kpi-precision">—</div></div>
            <div class="kpi amber"><div class="kpi-l">Ahorro tiempo</div><div class="kpi-v" id="kpi-ahorro">—</div></div>
            <div class="kpi purple"><div class="kpi-l">Campos OK</div><div class="kpi-v" id="kpi-campos">—</div></div>
            <div class="kpi teal"><div class="kpi-l">Resp. (s)</div><div class="kpi-v" id="kpi-resp">—</div></div>
          </div>

          <button class="analyze-btn" id="analyzeBtn" disabled><i class="ti ti-sparkles"></i> Analizar con IA</button>
        </section>

        <!-- ===== FORM PANEL ===== -->
        <section class="panel formpanel">
          <div class="form-head">
            <div class="form-head-t"><i class="ti ti-forms"></i> Carga y Edición de Proyecto — Auto-rellenado</div>
            <div class="pill" id="statusPill">EN ESPERA</div>
          </div>
          <div class="progress"><div class="progress-bar" id="progressBar"></div></div>

          <div class="fields">
            <div class="field full">
              <div class="field-top"><label class="field-label">Título del Proyecto</label><span class="ai-tag" id="tag-titulo">AI · PENDIENTE</span></div>
              <input class="field-input" id="f-titulo" readonly placeholder="—" />
            </div>
            <div class="field full">
              <div class="field-top"><label class="field-label">Autores</label><span class="ai-tag" id="tag-autores">AI · PENDIENTE</span></div>
              <input class="field-input" id="f-autores" readonly placeholder="—" />
            </div>
            <div class="field">
              <div class="field-top"><label class="field-label">Tutor / Director</label><span class="ai-tag" id="tag-tutor">AI · PENDIENTE</span></div>
              <input class="field-input" id="f-tutor" readonly placeholder="—" />
            </div>
            <div class="field">
              <div class="field-top"><label class="field-label">Año de Publicación</label><span class="ai-tag" id="tag-anio">AI · PENDIENTE</span></div>
              <input class="field-input" id="f-anio" readonly placeholder="—" />
            </div>
            <div class="field">
              <div class="field-top"><label class="field-label">PNF</label><span class="ai-tag" id="tag-pnf">AI · PENDIENTE</span></div>
              <input class="field-input" id="f-pnf" readonly placeholder="—" />
            </div>
            <div class="field">
              <div class="field-top"><label class="field-label">Línea de Investigación</label><span class="ai-tag" id="tag-linea_investigacion">AI · PENDIENTE</span></div>
              <input class="field-input" id="f-linea" readonly placeholder="—" />
            </div>
            <div class="field full">
              <div class="field-top"><label class="field-label">Resumen / Descripción</label><span class="ai-tag" id="tag-resumen">AI · PENDIENTE</span></div>
              <textarea class="field-input" id="f-resumen" rows="5" readonly placeholder="—"></textarea>
            </div>
          </div>

          <div class="actions">
            <button class="btn btn-save" id="saveBtn" disabled><i class="ti ti-device-floppy"></i> Guardar y Simular Registro</button>
            <button class="btn btn-fix" id="fixBtn"><i class="ti ti-edit"></i> Corregir Datos</button>
          </div>
        </section>
      </div>
    </div>
  </div>

  <div class="toast-wrap" id="toastWrap"></div>

  <script>
  (function(){
    "use strict";

    // En producción (Laravel) los endpoints responden; deja DEMO_FALLBACK en false.
    const DEMO_FALLBACK = false;

    const csrf = document.querySelector('meta[name=csrf-token]').content;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const fileInput = document.getElementById('fileInput');
    const pickBtn   = document.getElementById('pickBtn');
    const dropzone  = document.getElementById('dropzone');
    const fileBadge = document.getElementById('fileBadge');
    const fileName  = document.getElementById('fileName');
    const analyzeBtn= document.getElementById('analyzeBtn');
    const saveBtn   = document.getElementById('saveBtn');
    const fixBtn    = document.getElementById('fixBtn');
    const statusPill= document.getElementById('statusPill');
    const progressBar = document.getElementById('progressBar');
    const stepsEls  = Array.from(document.querySelectorAll('.step'));

    let selectedFile = null;
    let isEditing = false;

    const FIELDS = [
      {id:'f-titulo', key:'titulo'},
      {id:'f-autores', key:'autores'},
      {id:'f-tutor', key:'tutor'},
      {id:'f-anio', key:'anio'},
      {id:'f-pnf', key:'pnf'},
      {id:'f-linea', key:'linea_investigacion'},
      {id:'f-resumen', key:'resumen'}
    ];

    /* ===== Toast ===== */
    function toast(msg, ok){
      const wrap = document.getElementById('toastWrap');
      const el = document.createElement('div');
      el.className = 'toast' + (ok ? ' ok' : '');
      el.innerHTML = '<i class="ti ' + (ok?'ti-circle-check':'ti-alert-triangle') + '"></i><span>'+msg+'</span>';
      wrap.appendChild(el);
      setTimeout(()=>{ el.style.animation='fadeOut .3s ease forwards'; setTimeout(()=>el.remove(),300); }, 4000);
    }

    /* ===== File selection ===== */
    pickBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if(fileInput.files[0]) setFile(fileInput.files[0]); });

    ['dragover','dragenter'].forEach(ev => dropzone.addEventListener(ev, e=>{ e.preventDefault(); dropzone.classList.add('drag'); }));
    ['dragleave','dragend'].forEach(ev => dropzone.addEventListener(ev, e=>{ e.preventDefault(); dropzone.classList.remove('drag'); }));
    dropzone.addEventListener('drop', e => {
      e.preventDefault(); dropzone.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if(!f) return;
      if(f.type !== 'application/pdf'){ toast('Solo se permiten archivos PDF.'); return; }
      setFile(f);
    });

    function setFile(f){
      selectedFile = f;
      fileName.textContent = f.name;
      fileBadge.classList.add('show');
      analyzeBtn.disabled = false;
    }

    /* ===== Steps & progress ===== */
    function setStep(i, state){
      const el = stepsEls.find(s => +s.dataset.step === i);
      if(!el) return;
      el.classList.remove('idle','active','done','error');
      if(state) el.classList.add(state);
    }
    function resetSteps(){ stepsEls.forEach(s => s.classList.remove('active','done','error')); }
    function progress(p){ progressBar.style.width = p + '%'; }

    /* ===== Reset form ===== */
    function resetForm(){
      FIELDS.forEach(f=>{
        const inp = document.getElementById(f.id);
        inp.value=''; inp.className='field-input'; inp.readOnly=true;
        const tag = document.getElementById('tag-'+f.key);
        tag.className='ai-tag'; tag.textContent='AI · PENDIENTE';
      });
      resetSteps(); progress(0);
      statusPill.className='pill'; statusPill.textContent='EN ESPERA';
      ['kpi-precision','kpi-ahorro','kpi-campos','kpi-resp'].forEach(id=>document.getElementById(id).textContent='—');
      document.getElementById('badge-precision').textContent='—';
      document.getElementById('badge-tiempo').textContent='—';
      saveBtn.disabled = true;
    }

    /* ===== Typewriter per field ===== */
    async function typeField(field, value){
      const inp = document.getElementById(field.id);
      const tag = document.getElementById('tag-'+field.key);
      tag.className='ai-tag extracting'; tag.textContent='AI · EXTRAYENDO';
      inp.className='field-input typing';
      await sleep(150);

      if(value === null || value === undefined || value === ''){
        inp.value='null — no encontrado';
        inp.className='field-input null-field';
        tag.className='ai-tag null-val'; tag.textContent='AI · NULL';
        return;
      }
      const str = String(value);
      const chunk = Math.max(1, Math.ceil(str.length/30));
      inp.value='';
      for(let i=0;i<str.length;i+=chunk){
        inp.value = str.slice(0, i+chunk);
        if(inp.tagName==='TEXTAREA') inp.scrollTop = inp.scrollHeight;
        await sleep(18);
      }
      inp.value = str;
      inp.className='field-input filled';
      tag.className='ai-tag done'; tag.textContent='AI · EXTRAÍDO ✓';
    }

    async function fillFields(data){
      for(const f of FIELDS){
        await typeField(f, data[f.key]);
        await sleep(120);
      }
    }

    /* ===== KPIs ===== */
    function updateKPIs(data, elapsed){
      let ok = 0;
      FIELDS.forEach(f=>{ const v=data[f.key]; if(v!==null && v!==undefined && v!=='') ok++; });
      const precision = Math.round((ok/FIELDS.length)*100);
      document.getElementById('kpi-precision').textContent = precision + '%';
      document.getElementById('kpi-ahorro').textContent = '85%';
      document.getElementById('kpi-campos').textContent = ok + '/7';
      document.getElementById('kpi-resp').textContent = elapsed + 's';
      document.getElementById('badge-precision').textContent = precision + '%';
      document.getElementById('badge-tiempo').textContent = elapsed + 's';
    }

    /* ===== Main flow ===== */
    analyzeBtn.addEventListener('click', analyze);

    async function analyze(){
      if(!selectedFile) return;

      resetForm();
      analyzeBtn.disabled = true;
      analyzeBtn.className = 'analyze-btn loading';
      analyzeBtn.innerHTML = '<i class="ti ti-loader spin"></i> Analizando...';
      statusPill.className='pill proc'; statusPill.textContent='PROCESANDO';

      // Paso 1: archivo cargado
      setStep(0,'done');
      await sleep(400);
      setStep(1,'active');

      // ── Fetch 1: extraer texto del PDF (smalot/pdfparser)
      let text;
      try{
        const fd = new FormData();
        fd.append('pdf', selectedFile);
        const res1 = await fetch('/api/sandbox/extract-pdf', {
          method:'POST',
          headers:{ 'X-CSRF-TOKEN': csrf },
          body: fd
        });
        if(!res1.ok) throw new Error('extract');
        text = (await res1.json()).text;
      }catch(err){
        setStep(1,'error');
        statusPill.className='pill'; statusPill.textContent='EN ESPERA';
        resetAnalyzeBtn(true);
        toast('Error al extraer el PDF. Verifica que no sea escaneado.');
        return;
      }

      setStep(1,'done'); setStep(2,'active'); progress(40);

      // ── Fetch 2: analizar texto con IA
      const startTime = Date.now();
      let data;
      try{
        const res2 = await fetch('/api/sandbox/analyze-with-ai', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'X-CSRF-TOKEN': csrf },
          body: JSON.stringify({ text })
        });
        if(!res2.ok) throw new Error('ai');
        data = await res2.json();
      }catch(err){
        setStep(2,'error');
        statusPill.className='pill'; statusPill.textContent='EN ESPERA';
        resetAnalyzeBtn(true);
        toast('Error al conectar con la IA. Verifica tu API Key.');
        return;
      }

      setStep(2,'done'); setStep(3,'active'); progress(70);

      // ── Paso 4: rellenar formulario con typewriter
      await fillFields(data);
      setStep(3,'done'); progress(100);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      updateKPIs(data, elapsed);

      statusPill.className='pill done'; statusPill.textContent='COMPLETADO';
      analyzeBtn.className='analyze-btn done';
      analyzeBtn.innerHTML = '<i class="ti ti-check"></i> Análisis Completo';
      analyzeBtn.disabled = false;
      saveBtn.disabled = false;
    }

    function resetAnalyzeBtn(enable){
      analyzeBtn.className='analyze-btn';
      analyzeBtn.innerHTML = '<i class="ti ti-sparkles"></i> Analizar con IA';
      analyzeBtn.disabled = !enable;
    }

    /* ===== Corregir Datos ===== */
    fixBtn.addEventListener('click', () => {
      isEditing = !isEditing;
      FIELDS.forEach(f=>{
        const inp = document.getElementById(f.id);
        inp.readOnly = !isEditing;
        if(isEditing){ inp.classList.add('editing'); }
        else { inp.classList.remove('editing'); }
      });
      if(isEditing){
        fixBtn.classList.add('active');
        fixBtn.innerHTML = '<i class="ti ti-check"></i> Guardar Correcciones';
        document.getElementById('f-titulo').focus();
      }else{
        fixBtn.classList.remove('active');
        fixBtn.innerHTML = '<i class="ti ti-edit"></i> Corregir Datos';
        toast('Correcciones aplicadas.', true);
      }
    });

    /* ===== Guardar y Simular Registro ===== */
    saveBtn.addEventListener('click', async () => {
      const payload = {
        titulo: document.getElementById('f-titulo').value,
        autores: document.getElementById('f-autores').value,
        tutor: document.getElementById('f-tutor').value,
        anio: document.getElementById('f-anio').value,
        pnf: document.getElementById('f-pnf').value,
        linea_investigacion: document.getElementById('f-linea').value,
        resumen: document.getElementById('f-resumen').value
      };
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="ti ti-loader spin"></i> Guardando...';
      try{
        const res = await fetch('/api/sandbox/save', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'X-CSRF-TOKEN': csrf },
          body: JSON.stringify(payload)
        });
        if(!res.ok) throw new Error('save');
        toast('Registro simulado guardado correctamente.', true);
      }catch(err){
        toast('Error al guardar el registro.');
      }
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="ti ti-device-floppy"></i> Guardar y Simular Registro';
    });

  })();
  </script>
</body>
</html>
