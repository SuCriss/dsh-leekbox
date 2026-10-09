// 韭菜盒子 LeekBox — 客户端 bundle 源码：样式（含注入 IIFE）
// 由 build.mjs 打包进 lib/client.js（npm run build）；不要手改产物。

const CSS = `
.lkb_entry{box-sizing:border-box;width:100%;height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 10px;font-size:13px;display:flex}
.lkb_entry:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.lkb_entryIcon{flex:none;justify-content:center;align-items:center;width:24px;height:24px;display:inline-flex;font-size:16px;line-height:1}
.lkb_entryLabel{text-overflow:ellipsis;overflow:hidden}
[data-dsh-frame][data-sidebar-collapsed] .lkb_entry{border-radius:50%;justify-content:center;width:36px;height:36px;margin:0 auto 12px;padding:0}
[data-dsh-frame][data-sidebar-collapsed] .lkb_entryLabel{display:none}
.lkb_overlay{background:var(--dsw-alias-bg-mask-2,#080a1073);z-index:9999;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;display:block;position:fixed;inset:0}
.lkb_card{background:var(--dsw-alias-bg-overlay,#fdfdfd);width:min(980px,94vw);max-width:min(980px,calc(100vw - 16px));max-height:88vh;color:var(--dsw-alias-label-primary,#1c1e26);border-radius:14px;flex-direction:column;display:flex;overflow:hidden;box-shadow:0 20px 70px #00000059;position:fixed;z-index:10000;margin:0}
.lkb_head{background:var(--dsw-alias-bg-base,#fff);align-items:center;gap:12px;padding:12px 18px;display:flex;border-bottom:1px solid var(--dsw-alias-border-l1,#e8e9ed);cursor:grab;touch-action:none;user-select:none}
.lkb_head:active{cursor:grabbing}
.lkb_headTitle{margin:0;font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}
.lkb_headTitle .lkb-logo{font-size:18px}
.lkb_headSub{color:var(--dsw-alias-label-secondary,#8a8f9c);font-size:11px;font-weight:400}
.lkb_headRight{margin-left:auto;display:flex;align-items:center;gap:10px}
.lkb_mktStatus{font-size:11px;padding:3px 10px;border-radius:99px;background:var(--dsw-alias-bg-layer-1,#f2f3f5);color:var(--dsw-alias-label-secondary,#6b7280)}
.lkb_mktStatus[data-open="true"]{background:#ecfdf5;color:#0f7a50}
.lkb_mktStatus[data-open="false"]{background:#f2f3f5;color:#8a8f9c}
.lkb_close{cursor:pointer;background:0 0;border:none;color:var(--dsw-alias-label-secondary,#8a8f9c);font-size:20px;line-height:1;padding:4px 8px;border-radius:6px}
.lkb_close:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f3f5);color:var(--dsw-alias-label-primary)}
.lkb_tabs{display:flex;gap:4px;padding:10px 18px 0;background:var(--dsw-alias-bg-base,#fff);border-bottom:1px solid var(--dsw-alias-border-l1,#e8e9ed)}
.lkb_tab{border:1px solid transparent;color:var(--dsw-alias-label-secondary,#8a8f9c);cursor:pointer;background:0 0;border-radius:8px 8px 0 0;padding:7px 16px;font-size:13px;font-weight:500}
.lkb_tab:hover{background:var(--dsw-alias-interactive-bg-hover,#f5f6f8)}
.lkb_tab[data-active="true"]{color:var(--dsw-alias-label-primary,#1c1e26);font-weight:600;background:var(--dsw-alias-bg-layer-1,#f7f8fa);border-color:var(--dsw-alias-border-l1,#e8e9ed);border-bottom-color:transparent}
.lkb_body{padding:14px 18px 10px;overflow:auto;background:var(--dsw-alias-bg-layer-1,#f7f8fa);flex:1}
.lkb-stickyTop{position:sticky;top:-14px;z-index:8;background:var(--dsw-alias-bg-layer-1,#f7f8fa);margin:-14px -18px 10px;padding:10px 18px 6px;display:flex;flex-direction:column;gap:7px;box-shadow:0 10px 16px -14px #00000047;border-bottom:1px solid var(--dsw-alias-border-l1,#eceef1)}
.lkb-headRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.lkb-pills{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.lkb-pill{display:inline-flex;align-items:baseline;gap:5px;font-size:12px;padding:4px 11px;border-radius:99px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);color:var(--dsw-alias-label-secondary,#8a8f9c);white-space:nowrap}
.lkb-pill b{font-weight:700;font-variant-numeric:tabular-nums}
.lkb-pill .lkb-up{color:#e03131}
.lkb-pill .lkb-down{color:#0f9d6e}
.lkb-banner{display:flex;align-items:center;gap:6px;font-size:12px;padding:7px 12px;border-radius:10px;background:linear-gradient(90deg,#eef2ff,#f8faff);border:1px solid #d6defa;color:#4353a3;font-weight:600}
.lkb-banner .lkb-code{font-weight:500}
body[data-ds-dark-theme] .lkb-banner{background:#6378dc26;border-color:#6378dc55;color:#a5b4fc}
.lkb_foot{background:var(--dsw-alias-bg-base,#fff);border-top:1px solid var(--dsw-alias-border-l1,#e8e9ed);padding:8px 18px;color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px;display:flex;justify-content:space-between;gap:8px}
.lkb_card table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--dsw-alias-bg-base,#fff);border-radius:10px;overflow:hidden}
.lkb_card th{color:var(--dsw-alias-label-tertiary,#a2a7b3);text-align:right;font-weight:600;font-size:11px;letter-spacing:.05em;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#e8e9ed);white-space:nowrap;position:sticky;top:0;background:var(--dsw-alias-bg-base,#fff)}
.lkb_card th:first-child,.lkb_card td:first-child{text-align:left}
.lkb_card td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--dsw-alias-border-l1,#f2f3f5);white-space:nowrap;font-variant-numeric:tabular-nums}
.lkb_card tbody tr{cursor:pointer;transition:background .12s,box-shadow .12s;animation:lkb-rowIn .22s ease-out backwards}
.lkb_card tbody tr:hover{background:#f8f9fd;box-shadow:inset 2px 0 0 #4c6ef5}
@keyframes lkb-rowIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.lkb_name{font-weight:600;color:var(--dsw-alias-label-primary)}
.lkb_code{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px;margin-left:6px}
.lkb-up{color:#e03131}
.lkb-down{color:#0f9d6e}
/* ---- 报价板单元格(行情页) ---- */
.lkb-pct{display:inline-block;min-width:56px;text-align:center;font-weight:600;font-size:12px;padding:2px 7px;border-radius:6px;font-variant-numeric:tabular-nums;letter-spacing:.01em}
.lkb-pct.lkb-up{background:#e0313112;color:#d92d20}
.lkb-pct.lkb-down{background:#0f9d6e12;color:#0b8059}
.lkb-chipLabel{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a2a7b3);letter-spacing:.06em;font-weight:600;align-self:center;margin-right:3px}
body[data-ds-dark-theme] .lkb-pct.lkb-up{background:#e0313130;color:#ff8787}
body[data-ds-dark-theme] .lkb-pct.lkb-down{background:#0f9d6e30;color:#63e6be}
	/* ---- 大盘页市场情绪温度计(分段弧形仪表 + 无框数据行) ---- */
	.lkb-thermo{display:flex;gap:4px;align-items:center;flex-wrap:wrap;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 16px;margin-bottom:12px}
	.lkb-gauge{flex:none;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:196px}
	.lkb-gaugeScore{display:flex;align-items:baseline;gap:8px}
	.lkb-gaugeVal{font-size:32px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--lkb-tier-fg,#1c1e26)}
	.lkb-gaugeTier{font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;background:var(--lkb-tier-bg,#f1f3f5);color:var(--lkb-tier-fg,#495057);white-space:nowrap;cursor:default}
	.lkb-thermoStats{flex:1;min-width:320px;display:flex;align-items:stretch;flex-wrap:wrap;row-gap:8px}
	.lkb-tStat{flex:1;min-width:104px;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:6px 14px;border-left:1px solid var(--dsw-alias-border-l1,#eceef1)}
	.lkb-tStat:first-child{border-left:0;padding-left:4px}
	.lkb-tLabel{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a2a7b3);letter-spacing:.05em;white-space:nowrap}
	.lkb-tValue{font-size:21px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#1c1e26);white-space:nowrap}
	.lkb-tValue b{font-weight:700}
	.lkb-tValue i{font-style:normal;font-weight:400;font-size:14px;color:var(--dsw-alias-label-tertiary,#c0c4cc);margin:0 3px}
	.lkb-tBar{height:4px;border-radius:99px;background:#0f9d6e33;overflow:hidden;margin-top:1px}
	.lkb-tBarUp{height:100%;border-radius:99px;background:#e03131;transition:width .6s ease}
	body[data-ds-dark-theme] .lkb-thermo{background:#3a3a3c;border-color:#ffffff14}
	body[data-ds-dark-theme] .lkb-tStat{border-color:#ffffff0f}
	body[data-ds-dark-theme] .lkb-tBar{background:#0f9d6e45}
.lkb-star{cursor:pointer;background:0 0;border:none;font-size:14px;padding:2px 4px;opacity:.55}
.lkb-star:hover{opacity:1}
.lkb-star[data-on="true"]{opacity:1}
.lkb-searchWrap{position:relative;margin-bottom:12px}
.lkb-searchRow{display:flex;gap:8px;align-items:center;position:relative;z-index:31}
/* Opaque underlay: some DSH skins remap --dsw-alias-bg-base to a translucent
 * glass color (alpha can be 0), which would make the dropdown see-through.
 * Paint the alias over a solid base and flip the base in dark mode. */
.lkb-searchInput{background:linear-gradient(var(--dsw-alias-bg-base,#fff),var(--dsw-alias-bg-base,#fff)),#fff}
body[data-ds-dark-theme] .lkb-searchInput{background:linear-gradient(var(--dsw-alias-bg-base,#151517),var(--dsw-alias-bg-base,#151517)),#151517}
.lkb-input.lkb-searchInput{border-radius:10px;padding:8px 34px 8px 32px;font-size:13px}
.lkb-searchGlass{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:13px;pointer-events:none}
.lkb-searchClear{position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;background:var(--dsw-alias-bg-layer-1,#eef0f3);border:none;color:var(--dsw-alias-label-secondary,#8a8f9c);width:20px;height:20px;border-radius:50%;font-size:11px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}
.lkb-searchClear:hover{background:var(--dsw-alias-interactive-bg-hover,#e2e5ea);color:var(--dsw-alias-label-primary)}
.lkb-srCard{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:30;background:linear-gradient(var(--dsw-alias-bg-base,#fff),var(--dsw-alias-bg-base,#fff)),#fff;border:1px solid var(--dsw-alias-border-l1,#e5e7ec);border-radius:12px;box-shadow:0 14px 40px #00000026;overflow:hidden}
body[data-ds-dark-theme] .lkb-srCard{background:linear-gradient(var(--dsw-alias-bg-base,#151517),var(--dsw-alias-bg-base,#151517)),#151517}
/* In-panel confirm dialog (lkbConfirm) — modal mask + card */
.lkb_confirmMask{position:fixed;inset:0;z-index:2147483646;background:var(--dsw-alias-bg-mask-1,#0000003d);display:flex;align-items:center;justify-content:center}
.lkb_confirmBox{min-width:260px;max-width:340px;background:linear-gradient(var(--dsw-alias-bg-base,#fff),var(--dsw-alias-bg-base,#fff)),#fff;border:1px solid var(--dsw-alias-border-l1,#e5e7ec);border-radius:12px;box-shadow:0 18px 50px #00000040;padding:16px}
body[data-ds-dark-theme] .lkb_confirmBox{background:linear-gradient(var(--dsw-alias-bg-base,#151517),var(--dsw-alias-bg-base,#151517)),#151517}
.lkb_confirmText{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,#17264a);white-space:pre-wrap;word-break:break-all}
.lkb_confirmBtns{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.lkb-srMeta{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f3);font-size:11.5px;color:var(--dsw-alias-label-secondary,#8a8f9c)}
.lkb-srQuery{font-weight:600;color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-srNote{display:inline-flex;align-items:center;gap:6px}
.lkb-srClear{cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l1,#e3e5e9);color:var(--dsw-alias-label-secondary,#8a8f9c);border-radius:99px;padding:1px 10px;font-size:11px}
.lkb-srClear:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary,#b7bcc7)}
.lkb-srList{max-height:min(430px,52vh);overflow:auto;padding:4px 6px 6px}
.lkb-srItem{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:9px;cursor:pointer}
.lkb-srItem:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f3f5)}
.lkb-srItem + .lkb-srItem{margin-top:1px}
.lkb-srBadge{flex:none;width:40px;text-align:center;font-size:10px;font-weight:600;border-radius:6px;padding:2px 0;letter-spacing:.02em}
.lkb-srBadge.t-stock{background:#e8f6ee;color:#0f7a50}
.lkb-srBadge.t-etf{background:#eef2ff;color:#4353a3}
.lkb-srBadge.t-cb{background:#fff4e5;color:#b25e09}
.lkb-srBadge.t-lof{background:#f1f0fb;color:#6b5fa8}
body[data-ds-dark-theme] .lkb-srBadge.t-stock{background:#0f7a5030;color:#4ade80}
body[data-ds-dark-theme] .lkb-srBadge.t-etf{background:#4353a340;color:#a5b4fc}
body[data-ds-dark-theme] .lkb-srBadge.t-cb{background:#b25e0930;color:#fbbf24}
body[data-ds-dark-theme] .lkb-srBadge.t-lof{background:#6b5fa840;color:#c4b5fd}
.lkb-srId{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lkb-srQuote{flex:none;display:inline-flex;align-items:baseline;gap:7px;font-variant-numeric:tabular-nums;text-align:right}
.lkb-srPrice{font-weight:600;font-size:12.5px}
.lkb-srPct{font-size:11.5px;min-width:52px}
.lkb-srQuote:not(.lkb-up):not(.lkb-down) .lkb-srPrice,.lkb-srQuote:not(.lkb-up):not(.lkb-down) .lkb-srPct{color:var(--dsw-alias-label-tertiary,#a2a7b3)}
.lkb-srStar{flex:none}
.lkb-srEmpty{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:12px;padding:18px 14px;text-align:center;line-height:1.6}
.lkb-srSkeletons{padding:6px}
.lkb-srSkeleton{height:30px;border-radius:8px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-1,#f1f2f4) 25%,var(--dsw-alias-interactive-bg-hover,#e9ebef) 45%,var(--dsw-alias-bg-layer-1,#f1f2f4) 65%);background-size:280% 100%;animation:lkb-shimmer 1.2s infinite linear;margin:4px 2px}
@keyframes lkb-shimmer{0%{background-position:120% 0}100%{background-position:-120% 0}}
.lkb-input{box-sizing:border-box;background:var(--dsw-alias-bg-base,#fff);width:100%;color:var(--dsw-alias-label-primary,#1c1e26);border:1px solid var(--dsw-alias-border-l1,#d7dae0);border-radius:8px;padding:7px 12px;font-size:13px;outline:none}
.lkb-input:focus{border-color:#4c6ef5;box-shadow:0 0 0 3px #4c6ef520}
.lkb-chip{cursor:pointer;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#dcdfe5);color:var(--dsw-alias-label-secondary,#5f6672);border-radius:99px;padding:3px 11px;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;transition:border-color .12s, background .12s, color .12s}
.lkb-chip:hover{border-color:#bac8ff;color:#364fc7}
.lkb-chip[data-active="true"]{background:#eef2ff;border-color:#91a4f5;color:#364fc7;font-weight:600}
.lkb-chipRow{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;align-items:center}
.lkb-empty{color:var(--dsw-alias-label-tertiary,#a2a7b3);text-align:center;padding:36px 0;font-size:13px}
.lkb-error{color:#d92d20;text-align:center;padding:16px;font-size:12.5px}
.lkb-status{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11.5px;padding:6px 2px;display:flex;gap:12px;align-items:center}
.lkb-btn{cursor:pointer;background:#111;color:#fff;border:1px solid transparent;border-radius:8px;padding:7px 16px;font-size:12.5px;white-space:nowrap}
.lkb-btn:hover{background:#2a2a2c}
.lkb-btnGhost{cursor:pointer;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1,#d7dae0);border-radius:8px;padding:7px 14px;font-size:12.5px;white-space:nowrap}
.lkb-btnGhost:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f3f5)}
.lkb-btn:disabled,.lkb-btnGhost:disabled{opacity:.5;cursor:default}
.lkb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:10px}
.lkb-indexCard{position:relative;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:14px 16px;cursor:pointer;overflow:hidden;transition:border-color .15s, box-shadow .15s, transform .15s}
.lkb-indexCard::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--lkb-dir,#ced4da)}
.lkb-indexCard:hover{border-color:#bac8ff;box-shadow:0 4px 18px #4c6ef517;transform:translateY(-1px)}
.lkb-indexName{font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
.lkb-indexName .lkb-tag{font-size:10px;color:var(--dsw-alias-label-tertiary,#a2a7b3);background:var(--dsw-alias-bg-layer-1,#f2f3f5);padding:2px 8px;border-radius:99px;font-weight:400}
.lkb-indexValue{font-size:24px;font-weight:700;margin:6px 0 2px;font-variant-numeric:tabular-nums}
.lkb-indexChange{font-size:13px;font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:6px}
.lkb-indexArrow{font-size:11px;font-weight:700}
.lkb-indexMeta{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px;margin-top:8px;display:flex;gap:10px}
.lkb-detailHead{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.lkb-detailName{font-size:17px;font-weight:700}
.lkb-detailQuote{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.lkb-qItem .lkb-qLabel{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px;margin-bottom:2px}
.lkb-qItem .lkb-qValue{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.lkb-chartBox{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.lkb-chartTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#5f6672);display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.lkb-periodRow{display:flex;gap:4px}
.lkb-period{font-size:11px;cursor:pointer;padding:2px 8px;border-radius:6px;color:var(--dsw-alias-label-secondary,#8a8f9c);background:0 0;border:1px solid transparent}
.lkb-period[data-active="true"]{background:#eef2ff;color:#4353a3;font-weight:600}
.lkb-newsItem{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:10px;padding:10px 14px;margin-bottom:8px}
.lkb-newsMeta{display:flex;gap:8px;align-items:center;margin-bottom:5px;font-size:11px;color:var(--dsw-alias-label-tertiary,#a2a7b3)}
.lkb-newsTag{background:#eef2ff;color:#4353a3;border-radius:99px;padding:1px 8px;font-size:10px}
.lkb-newsText{font-size:12.8px;line-height:1.65;color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-newsStocks{margin-top:7px;display:flex;gap:6px;flex-wrap:wrap}
.lkb-stockChip{cursor:pointer;font-size:11px;color:#4353a3;background:#eef2ff;border-radius:99px;padding:2px 10px}
.lkb-stockChip:hover{background:#dfe6ff}
.lkb-filters{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.lkb-filter{display:flex;flex-direction:column;gap:4px}
.lkb-filter label{font-size:11px;color:var(--dsw-alias-label-tertiary,#a2a7b3)}
.lkb-pager{display:flex;justify-content:center;gap:8px;padding:10px 0}
.lkb-filterCard{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 14px;margin-bottom:10px}
.lkb-secTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#5f6672);margin-bottom:8px}
.lkb-sigGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(152px,1fr));gap:6px}
.lkb-check{cursor:pointer;background:var(--dsw-alias-bg-layer-1,#f7f8fa);border:1px solid var(--dsw-alias-border-l1,#e3e5e9);color:var(--dsw-alias-label-secondary,#5f6672);border-radius:8px;padding:6px 10px;font-size:12px;display:flex;gap:6px;align-items:center;user-select:none}
.lkb-check input{margin:0;accent-color:#4c6ef5}
.lkb-check[data-on="true"]{background:#eef2ff;border-color:#c7d2fe;color:#4353a3;font-weight:600}
.lkb-runRow{display:flex;gap:10px;align-items:flex-end;margin-bottom:10px;flex-wrap:wrap}
.lkb-progressWrap{margin-bottom:10px}
.lkb-progress{height:5px;background:var(--dsw-alias-bg-layer-1,#eef0f3);border-radius:99px;overflow:hidden;margin-top:6px}
.lkb-progressBar{height:100%;background:#4c6ef5;transition:width .3s}
.lkb-score{display:inline-block;min-width:36px;text-align:center;font-weight:700;font-size:13px;padding:2px 6px;border-radius:6px;background:#eef2ff;color:#4353a3;font-variant-numeric:tabular-nums}
body[data-ds-dark-theme] .lkb_card,body[data-ds-dark-theme] .lkb_head,body[data-ds-dark-theme] .lkb_tabs,body[data-ds-dark-theme] .lkb_foot{background:#2c2c2e}
body[data-ds-dark-theme] .lkb_body{background:#1e1e1e}
body[data-ds-dark-theme] .lkb_card table,body[data-ds-dark-theme] .lkb_indexCard,body[data-ds-dark-theme] .lkb_detailQuote,body[data-ds-dark-theme] .lkb_chartBox,body[data-ds-dark-theme] .lkb_newsItem,body[data-ds-dark-theme] .lkb_filters,body[data-ds-dark-theme] .lkb_input{background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb_card th{background:#3a3a3c;border-color:#ffffff0f}
body[data-ds-dark-theme] .lkb_card td{border-color:#ffffff0d}
body[data-ds-dark-theme] .lkb_card tbody tr:hover,body[data-ds-dark-theme] .lkb_close:hover,body[data-ds-dark-theme] .lkb_tab:hover,body[data-ds-dark-theme] .lkb-btnGhost:hover{background:#ffffff12}
body[data-ds-dark-theme] .lkb_card tbody tr:hover{box-shadow:inset 2px 0 0 #6378dc}
body[data-ds-dark-theme] .lkb-chip{background:#2c2c2e;border-color:#ffffff14;color:#c0c4cc}
body[data-ds-dark-theme] .lkb-chip:hover{border-color:#6378dc66;color:#dbe4ff}
body[data-ds-dark-theme] .lkb_tab[data-active="true"]{color:#fff;background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb-btn{color:#111827;background:#e5e5ea}
body[data-ds-dark-theme] .lkb-btn:hover{background:#d1d5db}
body[data-ds-dark-theme] .lkb-mktStatus[data-open="true"]{background:#30d15826;color:#30d158}
body[data-ds-dark-theme] .lkb-chip[data-active="true"],body[data-ds-dark-theme] .lkb-period[data-active="true"]{background:#6378dc38;color:#a5b4fc;border-color:#6378dc66}
body[data-ds-dark-theme] .lkb-newsTag,body[data-ds-dark-theme] .lkb-stockChip{color:#a5b4fc;background:#6378dc38}
body[data-ds-dark-theme] .lkb-stockChip:hover{background:#6378dc5c}
body[data-ds-dark-theme] .lkb-filterCard,body[data-ds-dark-theme] .lkb-check{background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb-check[data-on="true"],body[data-ds-dark-theme] .lkb-score{background:#6378dc38;color:#a5b4fc;border-color:#6378dc66}
body[data-ds-dark-theme] .lkb-progressBar{background:#6378dc}
.lkb-win{position:fixed;background:var(--dsw-alias-bg-overlay,#fdfdfd);color:var(--dsw-alias-label-primary,#1c1e26);border-radius:14px;width:min(760px,94vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px #00000066;animation:lkb-pop .14s ease-out;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
@keyframes lkb-pop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
.lkb-mktTag{flex:none;font-size:10px;color:var(--dsw-alias-label-secondary,#8a8f9c);background:var(--dsw-alias-bg-layer-1,#f2f3f5);padding:2px 8px;border-radius:99px;font-weight:500}
.lkb-hero{display:flex;gap:18px;align-items:stretch;flex-wrap:wrap;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:12px;padding:12px 16px;margin-bottom:12px}
.lkb-heroMain{display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:150px}
.lkb-heroPrice{font-size:32px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
.lkb-heroSub{font-size:13.5px;font-weight:600;display:flex;gap:10px;font-variant-numeric:tabular-nums}
.lkb-heroMeta{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11px}
.lkb-heroGrid{flex:1;min-width:300px;display:grid;grid-template-columns:repeat(auto-fill,minmax(102px,1fr));gap:6px 16px;align-content:center}
.lkb-kTip{position:absolute;z-index:6;pointer-events:none;background:var(--dsw-alias-bg-overlay,#fdfdfd);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:10px;padding:7px 12px;box-shadow:0 8px 28px #00000033;display:grid;grid-template-columns:auto auto;gap:3px 12px;font-size:11.5px;line-height:1.25;color:var(--dsw-alias-label-secondary,#5f6672);font-variant-numeric:tabular-nums;white-space:nowrap}
.lkb-kTip .tipDate{grid-column:1/-1;font-weight:700;color:var(--dsw-alias-label-primary,#1c1e26);margin-bottom:2px}
.lkb-kTip b{font-weight:600;text-align:right;color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-kTip b.lkb-up{color:#e03131}
.lkb-kTip b.lkb-down{color:#0f9d6e}
.lkb-kTip .srRes{color:#e03131;font-weight:600}
.lkb-kTip .srSup{color:#0f9d6e;font-weight:600}
.lkb-kTip .ma5{color:#e8590c}
.lkb-kTip .ma10{color:#4263eb}
.lkb-kTip .ma20{color:#9c36b5}
body[data-ds-dark-theme] .lkb-kTip{background:#3a3a3c;border-color:#ffffff1f;box-shadow:0 8px 28px #00000066}
body[data-ds-dark-theme] .lkb-kTip b,body[data-ds-dark-theme] .lkb-kTip .tipDate{color:#f1f1f2}
.lkb-kwrap{position:relative}
.lkb-kaxis{position:relative;height:16px;margin-top:3px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a2a7b3);font-variant-numeric:tabular-nums}
.lkb-kaxis span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
/* ---- 当日分时图(价格线+均价线+成交量,左右纵轴标签) ---- */
.lkb-maxis{position:absolute;inset:0;pointer-events:none;font-size:10px;line-height:1;font-variant-numeric:tabular-nums}
.lkb-maxL{position:absolute;left:2px;transform:translateY(-100%);color:var(--dsw-alias-label-tertiary,#a2a7b3)}
.lkb-maxR{position:absolute;right:2px;transform:translateY(-100%);color:var(--dsw-alias-label-tertiary,#a2a7b3)}
.lkb-maxR.lkb-up{color:#e03131}
.lkb-maxR.lkb-down{color:#0f9d6e}
/* ---- 资金流向柱状图 ---- */
.lkb-ffwrap{position:relative}
.lkb-ffaxis{position:relative;height:14px;margin-top:3px;font-size:10px;color:var(--dsw-alias-label-tertiary,#a2a7b3);font-variant-numeric:tabular-nums}
.lkb-ffaxis span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
.lkb-ffval{font-size:11.5px;color:var(--dsw-alias-label-secondary,#5f6672);font-variant-numeric:tabular-nums;min-height:16px;margin-top:2px}
.lkb-ffval b{font-weight:700}
/* ---- 自选股持仓单元格与汇总 ---- */
.lkb-posCell{cursor:pointer;border-bottom:1px dashed var(--dsw-alias-border-l1,#c9cdd4);padding:1px 2px}
.lkb-posCell:hover{color:var(--dsw-alias-label-primary);border-bottom-color:#4c6ef5}
.lkb-posEmpty{color:var(--dsw-alias-label-tertiary,#b7bcc7);font-size:11px}
.lkb-posSummary{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#5f6672);background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:10px;padding:8px 12px;margin-bottom:10px;font-variant-numeric:tabular-nums}
.lkb-posSummary b{font-weight:700;color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-posSummary b.lkb-up{color:#e03131}
.lkb-posSummary b.lkb-down{color:#0f9d6e}
.lkb-posTag{font-weight:700;font-size:11px;padding:2px 9px;border-radius:99px;background:#eef2ff;color:#4353a3;white-space:nowrap}
body[data-ds-dark-theme] .lkb-posTag{background:#4353a340;color:#a5b4fc}
/* ---- 价格预警卡片与表单 ---- */
.lkb-alertCard{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:10px;padding:8px 12px;margin-bottom:10px}
.lkb-alertHead{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}
.lkb-alertTitle{font-size:12.5px;font-weight:700;color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-alertForm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#f2f3f5)}
.lkb-alertList{display:flex;flex-direction:column}
.lkb-alertItem{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#f2f3f5);font-size:12px}
.lkb-alertItem:last-child{border-bottom:none}
.lkb-alertCond{color:#4353a3;font-weight:600;font-variant-numeric:tabular-nums;margin-left:auto}
body[data-ds-dark-theme] .lkb-alertCond{color:#a5b4fc}
.lkb-alertEmpty{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11.5px;padding:2px 0}
/* ---- 预警 toast(右下角,可叠 4 条) ---- */
.lkb-toasts{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;max-width:min(420px,86vw)}
.lkb-toast{cursor:pointer;background:linear-gradient(var(--dsw-alias-bg-base,#fff),var(--dsw-alias-bg-base,#fff)),#fff;border:1px solid #f0b37e;border-left:4px solid #f08c00;border-radius:10px;box-shadow:0 12px 40px #00000040;padding:10px 14px;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-primary,#1c1e26);font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums;animation:lkb-rowIn .18s ease-out}
body[data-ds-dark-theme] .lkb-toast{background:linear-gradient(#3a3a3c,#3a3a3c),#3a3a3c;border-color:#f08c0066}
body[data-ds-dark-theme] .lkb-win{background:#2c2c2e;box-shadow:0 24px 80px #000000cc}
body[data-ds-dark-theme] .lkb-win .lkb_head{background:#2c2c2e}
body[data-ds-dark-theme] .lkb-hero{background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb-mktTag{background:#3a3a3c;color:#a2a7b3}
.lkb-srcBadge{flex:none;font-size:10px;padding:1px 8px;border-radius:99px;background:#eef2ff;color:#4353a3}
.lkb-newsFlag{flex:none;background:#e03131;color:#fff;border-radius:99px;padding:1px 8px;font-size:10px;font-weight:700}
.lkb-newsItem.lkb-newsImportant{border-color:#f3b0b0;background:#fff6f6;box-shadow:inset 3px 0 0 #e03131}
.lkb-newsImportant .lkb-newsText{font-weight:600}
body[data-ds-dark-theme] .lkb-newsImportant{background:#3a2626;border-color:#e0313166}
body[data-ds-dark-theme] .lkb-srcBadge{background:#6378dc38;color:#a5b4fc}
/* ---- screener ---- */
.lkb-sc{display:flex;flex-direction:column;gap:12px}
.lkb-scHead{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:2px 2px 0}
.lkb-scTitle{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}
.lkb-scSub{color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:11.5px;margin-top:3px;font-weight:400}
.lkb-scCard{background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,#e8e9ed);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:13px}
.lkb-scDivider{height:1px;background:var(--dsw-alias-border-l1,#eceef1)}
.lkb-scRow{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
.lkb-condBlock{display:flex;flex-direction:column;gap:7px}
.lkb-scFieldLabel{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#a2a7b3);letter-spacing:.05em;font-weight:600}
.lkb-seg{display:inline-flex;background:var(--dsw-alias-bg-layer-1,#f2f3f5);border-radius:9px;padding:3px;gap:2px;width:max-content}
.lkb-segBtn{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;padding:5px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:color .12s, background .12s}
.lkb-segBtn:hover{color:var(--dsw-alias-label-primary,#1c1e26)}
.lkb-segBtn[data-active="true"]{background:var(--dsw-alias-bg-base,#fff);color:#364fc7;font-weight:600;box-shadow:0 1px 3px #0000001f}
.lkb-scSelect{width:auto !important;min-width:132px;padding:6px 10px;font-size:12.5px}
.lkb-rangeGroup{display:flex;align-items:center;gap:6px}
.lkb-rangeGroup .lkb-input{width:78px;padding:6px 8px;font-size:12.5px;text-align:center}
.lkb-rangeTilde{color:#adb5bd;font-size:12px}
.lkb-unit{font-size:11.5px;color:var(--dsw-alias-label-secondary,#5f6672);white-space:nowrap}
.lkb-switch{cursor:pointer;display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#495057);user-select:none;height:26px}
.lkb-switchTrack{flex:none;width:32px;height:18px;border-radius:99px;background:#ced4da;position:relative;transition:background .18s}
.lkb-switchTrack::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .18s;box-shadow:0 1px 2px #00000040}
.lkb-switch[data-on="true"] .lkb-switchTrack{background:#4c6ef5}
.lkb-switch[data-on="true"] .lkb-switchTrack::after{left:16px}
.lkb-sigGroups{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px}
.lkb-sigGroup{border:1px solid var(--dsw-alias-border-l1,#eceef1);border-radius:11px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1,#fafbfc)}
.lkb-sigGroupTitle{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;font-weight:700;color:var(--dsw-alias-label-secondary,#5f6672);margin-bottom:8px}
.lkb-sigCount{font-size:10px;border-radius:99px;padding:1px 7px;background:var(--dsw-alias-bg-layer-1,#f1f3f5);color:var(--dsw-alias-label-tertiary,#868e96);font-variant-numeric:tabular-nums;font-weight:600}
.lkb-sigCount[data-n="true"]{background:#eef2ff;color:#4353a3}
.lkb-chip2{cursor:pointer;border:1px solid var(--dsw-alias-border-l1,#e3e5e9);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#495057);border-radius:8px;padding:5px 10px;font-size:12px;transition:border-color .12s, background .12s, color .12s;display:inline-flex;align-items:center;gap:6px}
.lkb-chip2:hover{border-color:#bac8ff;color:#364fc7}
.lkb-chip2[data-on="true"]{background:#eef2ff;border-color:#91a4f5;color:#364fc7;font-weight:600}
.lkb-chip2Dot{width:5px;height:5px;border-radius:50%;background:#ced4da;flex:none;transition:background .12s}
.lkb-chip2[data-on="true"] .lkb-chip2Dot{background:#4c6ef5}
.lkb-scActions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.lkb-scoreInput{width:56px !important;text-align:center;padding:6px 8px !important}
.lkb-runBtn{cursor:pointer;border:none;border-radius:9px;padding:9px 24px;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(135deg,#4c6ef5,#6741d9);box-shadow:0 2px 10px #4c6ef55c;transition:transform .1s, box-shadow .15s, filter .15s;letter-spacing:.02em}
.lkb-runBtn:hover{box-shadow:0 4px 16px #4c6ef573;filter:brightness(1.06)}
.lkb-runBtn:active{transform:translateY(1px)}
.lkb-runBtn:disabled{opacity:.55;cursor:default;transform:none}
.lkb-resCard{animation:lkb-pop .18s ease-out}
.lkb-resSummary{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#343a40);padding:2px 2px 8px}
.lkb-rankNum{display:inline-block;width:22px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#adb5bd)}
.lkb-rankNum[data-medal="1"]{color:#f08c00}
.lkb-rankNum[data-medal="2"]{color:#74a3d3}
.lkb-rankNum[data-medal="3"]{color:#c98a4b}
.lkb-scorePill{display:inline-block;min-width:36px;text-align:center;font-weight:700;font-size:12.5px;padding:3px 9px;border-radius:8px;font-variant-numeric:tabular-nums}
.lkb-scorePill[data-tier="0"]{background:#f1f3f5;color:#868e96}
.lkb-scorePill[data-tier="1"]{background:#edf2ff;color:#4263eb}
.lkb-scorePill[data-tier="2"]{background:#dbe4ff;color:#3b5bdb}
.lkb-scorePill[data-tier="3"]{background:#4c6ef5;color:#fff}
.lkb-signalTags{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:300px;margin-left:auto}
.lkb-signalTag{font-size:10.5px;color:#4353a3;background:#eef2ff;border-radius:6px;padding:2px 7px;white-space:nowrap}
.lkb-signalMore{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#868e96);align-self:center}
.lkb-emptyState{text-align:center;padding:44px 0;color:var(--dsw-alias-label-tertiary,#a2a7b3);font-size:13px}
.lkb-emptyIcon{font-size:30px;margin-bottom:8px;opacity:.7}
body[data-ds-dark-theme] .lkb-scCard,body[data-ds-dark-theme] .lkb-sigGroup{background:#3a3a3c;border-color:#ffffff14}
body[data-ds-dark-theme] .lkb-seg{background:#242426}
body[data-ds-dark-theme] .lkb-segBtn[data-active="true"]{background:#ffffff1f;color:#dbe4ff;box-shadow:none}
body[data-ds-dark-theme] .lkb-chip2,body[data-ds-dark-theme] .lkb-switchTrack{background:#2c2c2e}
body[data-ds-dark-theme] .lkb-chip2{border-color:#ffffff14;color:#c0c4cc}
body[data-ds-dark-theme] .lkb-chip2:hover{border-color:#6378dc66;color:#dbe4ff}
body[data-ds-dark-theme] .lkb-chip2[data-on="true"]{background:#6378dc38;border-color:#6378dc66;color:#dbe4ff}
body[data-ds-dark-theme] .lkb-runBtn{background:linear-gradient(135deg,#5c7cfa,#7950f2)}
body[data-ds-dark-theme] .lkb-scorePill[data-tier="1"]{background:#6378dc38;color:#bac8ff}
body[data-ds-dark-theme] .lkb-scorePill[data-tier="2"]{background:#6378dc52;color:#dbe4ff}
body[data-ds-dark-theme] .lkb-scorePill[data-tier="3"]{background:#4c6ef5;color:#fff}
body[data-ds-dark-theme] .lkb-signalTag{background:#6378dc38;color:#dbe4ff}
/* ---- loading affordance ---- */
.lkb-spinner{flex:none;width:12px;height:12px;border:2px solid #dbe4ff;border-top-color:#4c6ef5;border-radius:50%;display:inline-block;animation:lkb-spin .7s linear infinite}
@keyframes lkb-spin{to{transform:rotate(360deg)}}
.lkb-loadbar{height:3px;border-radius:99px;background:#eef0f3;overflow:hidden;margin:6px 0 10px}
.lkb-loadbar::after{content:"";display:block;height:100%;width:38%;background:linear-gradient(90deg,#4c6ef5,#91a7ff);border-radius:99px;animation:lkb-slide 1.1s ease-in-out infinite}
@keyframes lkb-slide{0%{transform:translateX(-110%)}100%{transform:translateX(280%)}}
body[data-ds-dark-theme] .lkb-loadbar{background:#3a3a3c}
`;
(function injectStyle() {
	if (typeof document === "undefined") return;
	if (document.getElementById("dsh-leekbox-style") !== null) return;
	const style = document.createElement("style");
	style.id = "dsh-leekbox-style";
	style.textContent = CSS;
	document.head.appendChild(style);
})();
