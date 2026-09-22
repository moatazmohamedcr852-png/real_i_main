import{r as e}from"./rolldown-runtime-QTnfLwEv.js";import{It as t,Lt as n,an as r,cn as i,en as a,sn as o}from"./vendor-react-CeZ512P1.js";var s=e(i(),1),c=e(o(),1),l=r();function u({value:e,onChange:r,options:i,placeholder:o=`Select an option...`,className:u=``,disabled:d=!1}){let[f,p]=(0,s.useState)(!1),[m,h]=(0,s.useState)(!1),[g,_]=(0,s.useState)({top:0,left:0,width:0}),v=(0,s.useRef)(null),y=(0,s.useRef)(null),b=(0,s.useCallback)(()=>{if(v.current){let e=v.current.getBoundingClientRect(),t=window.innerHeight-e.bottom<280&&e.top>280;_({top:t?e.top-8:e.bottom+8,left:e.left,width:e.width,openAbove:t})}},[]),x=(0,s.useCallback)(()=>{h(!0),setTimeout(()=>{p(!1),h(!1)},250)},[]);(0,s.useEffect)(()=>{if(!f)return;let e=e=>{v.current&&!v.current.contains(e.target)&&y.current&&!y.current.contains(e.target)&&x()};return document.addEventListener(`mousedown`,e),()=>document.removeEventListener(`mousedown`,e)},[f,x]),(0,s.useEffect)(()=>{if(f)return b(),window.addEventListener(`scroll`,b,!0),window.addEventListener(`resize`,b),()=>{window.removeEventListener(`scroll`,b,!0),window.removeEventListener(`resize`,b)}},[f,b]),(0,s.useEffect)(()=>{if(!f)return;let e=e=>{e.key===`Escape`&&x()};return document.addEventListener(`keydown`,e),()=>document.removeEventListener(`keydown`,e)},[f,x]);let S=i.map(e=>typeof e==`string`?{value:e,label:e}:e),C=S.find(t=>t.value===e);return(0,l.jsxs)(l.Fragment,{children:[(0,l.jsx)(`style`,{children:`
        @keyframes premium-dropdown-enter {
          0% {
            opacity: 0;
            transform: scale(0.9) translateY(${g.openAbove?`15px`:`-15px`}) rotateX(${g.openAbove?`-10deg`:`10deg`});
            filter: blur(4px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0) rotateX(0);
            filter: blur(0);
          }
        }
        @keyframes premium-dropdown-exit {
          0% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          100% {
            opacity: 0;
            transform: scale(0.95) translateY(${g.openAbove?`10px`:`-10px`});
          }
        }
        @keyframes premium-item-enter {
          0% {
            opacity: 0;
            transform: translateX(-10px) scale(0.95);
          }
          100% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
      `}),(0,l.jsx)(`div`,{className:`relative ${u}`,children:(0,l.jsxs)(`button`,{ref:v,type:`button`,disabled:d,onClick:()=>{d||(f?x():(b(),p(!0)))},className:`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-sm font-medium outline-none transition-all duration-300 
            ${f?`bg-surface-900 border-primary-500/60 ring-4 ring-primary-500/10 text-surface-50 shadow-[0_0_20px_rgba(212,175,55,0.15)]`:`bg-surface-950/80 border-surface-700 text-surface-200 hover:border-surface-600 hover:bg-surface-900 shadow-inner`}
            ${d?`opacity-50 cursor-not-allowed grayscale`:`cursor-pointer`}
          `,children:[(0,l.jsxs)(`span`,{className:`transition-colors duration-300 ${C?`text-surface-50`:`text-surface-500`} flex items-center gap-2`,children:[C&&(0,l.jsx)(`span`,{className:`w-1.5 h-1.5 rounded-full bg-primary-400 shadow-[0_0_8px_rgba(212,175,55,0.8)]`}),C?C.label:o]}),(0,l.jsx)(`div`,{className:`w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300 ${f?`bg-primary-500/10 text-primary-400`:`bg-surface-800 text-surface-500`}`,children:(0,l.jsx)(t,{size:14,className:`transition-transform duration-500 ${f?`rotate-180`:``}`})})]})}),f&&!d&&(0,c.createPortal)((0,l.jsxs)(`div`,{ref:y,style:{...(()=>{let e={position:`fixed`,left:g.left,width:g.width,zIndex:99999,transformOrigin:g.openAbove?`bottom center`:`top center`};return g.openAbove?e.bottom=window.innerHeight-g.top:e.top=g.top,m?e.animation=`premium-dropdown-exit 250ms cubic-bezier(0.3, 0, 0.2, 1) forwards`:e.animation=`premium-dropdown-enter 400ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,e})(),perspective:`1000px`},className:`rounded-xl overflow-hidden shadow-2xl dark:shadow-[0_16px_40px_rgba(0,0,0,0.9),_0_0_2px_rgba(212,175,55,0.5)] border border-surface-700 bg-white dark:bg-[#0a0a0a]`,children:[(0,l.jsx)(`div`,{className:`absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-primary-500/5 to-transparent pointer-events-none rounded-t-xl`}),(0,l.jsx)(`ul`,{className:`relative z-10 max-h-[260px] overflow-y-auto p-2 custom-scrollbar`,children:S.length===0?(0,l.jsx)(`li`,{className:`px-4 py-4 text-sm text-surface-500 text-center font-mono tracking-widest uppercase`,children:`No options`}):S.map((t,i)=>{let o=e===t.value;return(0,l.jsxs)(`li`,{onClick:()=>{r(t.value),x()},style:{animation:`premium-item-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) ${i*30+50}ms both`},className:`relative flex items-center justify-between px-4 py-3 rounded-lg text-sm cursor-pointer transition-all duration-300 group/item overflow-hidden mb-1 last:mb-0
                      ${o?`text-primary-400 font-bold`:`text-surface-300 hover:text-surface-50`}
                    `,children:[o&&(0,l.jsx)(`div`,{className:`absolute inset-0 bg-gradient-to-r from-primary-500/20 to-transparent border-l-2 border-primary-500 rounded-lg`}),(0,l.jsx)(`div`,{className:`absolute inset-0 bg-transparent group-hover/item:bg-black/5 dark:group-hover/item:bg-white/5 rounded-lg transition-colors duration-300`}),(0,l.jsxs)(`span`,{className:`relative z-10 flex items-center gap-3 transition-transform duration-300 group-hover/item:translate-x-1`,children:[o?(0,l.jsx)(n,{size:14,className:`text-primary-400`}):(0,l.jsx)(`span`,{className:`w-1.5 h-1.5 rounded-full bg-surface-700 group-hover/item:bg-primary-400/50 transition-colors duration-300`}),t.label]}),!o&&(0,l.jsx)(a,{size:14,className:`relative z-10 text-primary-400 opacity-0 -translate-x-2 group-hover/item:opacity-100 group-hover/item:translate-x-0 transition-all duration-300`})]},t.value)})})]}),document.body)]})}export{u as t};