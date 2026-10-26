<!-- Décor : coffre au trésor rendu dans Blender.
     Les effets restent décoratifs et ne capturent aucun geste du joueur. -->
<div class="captains-table" aria-hidden="true">
  <div class="sea-light"></div>
  <img class="table-render" src="/ui/table-study-treasure.webp" alt="" fetchpriority="high" draggable="false" />
  <div class="lantern-light"></div>
  <div class="motes"><i></i><i></i><i></i><i></i><i></i><i></i></div>
</div>

<style>
  .captains-table{position:relative;width:100%;height:100%;isolation:isolate;pointer-events:none;overflow:clip}
  .table-render{position:absolute;width:120%;height:120%;max-width:none;left:-10%;top:-10%;object-fit:contain;filter:drop-shadow(0 24px 20px #0007)}
  .sea-light{position:absolute;inset:3% 0 20%;background:radial-gradient(ellipse at 65% 45%,#479e9136,transparent 66%);filter:blur(24px)}
  .lantern-light{position:absolute;left:76%;top:52%;width:20%;height:24%;background:radial-gradient(ellipse,#ffd78975 0,#ffb44124 28%,transparent 68%);mix-blend-mode:screen;animation:candle-breathe 4.7s ease-in-out infinite alternate}
  .motes{position:absolute;inset:4% 0 10%;overflow:hidden;mask-image:linear-gradient(transparent,#000 25%,#000 70%,transparent)}
  .motes i{position:absolute;left:18%;bottom:0;width:3px;height:3px;border-radius:50%;background:#ffe0a0;box-shadow:0 0 8px #efb351;opacity:0;animation:drift 12s linear infinite}
  .motes i:nth-child(2){left:36%;animation-delay:-7s;animation-duration:15s}
  .motes i:nth-child(3){left:62%;animation-delay:-3s;width:2px;height:2px}
  .motes i:nth-child(4){left:83%;animation-delay:-10s;animation-duration:16s}
  .motes i:nth-child(5){left:49%;animation-delay:-5s;animation-duration:18s;width:2px;height:2px}
  .motes i:nth-child(6){left:72%;animation-delay:-11s;animation-duration:14s}
  @keyframes candle-breathe{0%,100%{opacity:.65;transform:scale(.95)}35%{opacity:.9}70%{opacity:.72;transform:scale(1.08)}}
  @keyframes drift{0%{transform:translate(0,0);opacity:0}25%{opacity:.45}75%{opacity:.2}100%{transform:translate(18px,-240px);opacity:0}}
  @media(max-height:740px) and (max-width:759px){.table-render{width:140%;height:140%;left:-20%;top:-20%}.lantern-light{left:78%;top:54%}}
  @media(prefers-reduced-motion:reduce){.lantern-light,.motes i{animation:none}.motes{display:none}}
  :global(html[data-motion='reduce']) .lantern-light,:global(html[data-motion='reduce']) .motes i{animation:none}
  :global(html[data-motion='reduce']) .motes{display:none}
</style>
