var e=Object.defineProperty,t=(t,n)=>{let r={};for(var i in t)e(r,i,{get:t[i],enumerable:!0});return n||e(r,Symbol.toStringTag,{value:`Module`}),r};(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var n=class{settings;context=null;master=null;unlocked=!1;unlockPromise=null;crowdStarted=!1;destroyed=!1;timers=new Set;lastBreathTick=-300;lastHeartbeatTick=-300;unlockListener=()=>{this.unlock().catch(()=>void 0)};visibility=()=>{let e=this.context;if(e===null)return;let t=document.hidden?e.suspend():this.unlocked?e.resume():null;t!==null&&t.catch(()=>void 0)};constructor(e){this.settings=e,window.addEventListener(`pointerdown`,this.unlockListener),window.addEventListener(`keydown`,this.unlockListener),document.addEventListener(`visibilitychange`,this.visibility)}unlock(){return this.destroyed||this.unlocked?Promise.resolve():(this.unlockPromise===null&&(this.unlockPromise=this.performUnlock().finally(()=>{this.unlockPromise=null})),this.unlockPromise)}async performUnlock(){this.context===null&&(this.context=new AudioContext,this.master=this.context.createGain(),this.master.gain.value=Math.min(.8,Math.max(0,this.settings().volume)),this.master.connect(this.context.destination)),this.context.state===`suspended`&&await this.context.resume(),!this.destroyed&&(this.unlocked=!0,window.removeEventListener(`pointerdown`,this.unlockListener),window.removeEventListener(`keydown`,this.unlockListener),this.crowdStarted||(this.crowdStarted=!0,this.crowdBed()))}setVolume(){this.master!==null&&(this.master.gain.value=Math.min(.8,Math.max(0,this.settings().volume)))}event(e){this.unlocked&&(e.kind===`bell`?this.tone(720,1.15,`sine`,.22):e.kind===`hit`||e.kind===`counter_hit`?(this.noise(.08,e.detail.includes(`body`)?150:230,.28),this.tone(e.detail.includes(`body`)?85:125,.09,`triangle`,.14)):e.kind===`block`?this.noise(.055,380,.16):e.kind===`knockdown`?(this.noise(.2,90,.3),this.tone(58,.32,`sine`,.2)):e.kind===`count`?this.tone(330,.12,`square`,.08):(e.kind===`rope`||e.kind===`clinch_start`)&&this.noise(.11,110,.13))}snapshot(e,t,n,r){if(!this.unlocked)return;let i=1-t/Math.max(1,n);i>.55&&e-this.lastBreathTick>=75&&(this.lastBreathTick=e,this.noise(.18,420,.045+i*.04)),(i>.72||r>500)&&e-this.lastHeartbeatTick>=24&&(this.lastHeartbeatTick=e,this.tone(52,.09,`sine`,.055))}result(e){if(!this.unlocked)return;this.tone(e.winner_id===null?280:520,.45,`triangle`,.18);let t=window.setTimeout(()=>{this.timers.delete(t),this.tone(650,.5,`triangle`,.14)},160);this.timers.add(t)}tone(e,t,n,r){let i=this.context,a=this.master;if(i===null||a===null)return;let o=i.createOscillator(),s=i.createGain();o.type=n,o.frequency.value=e,s.gain.setValueAtTime(1e-4,i.currentTime),s.gain.exponentialRampToValueAtTime(Math.min(.35,r),i.currentTime+.012),s.gain.exponentialRampToValueAtTime(1e-4,i.currentTime+Math.min(1.2,t)),o.connect(s).connect(a),o.start(),o.stop(i.currentTime+Math.min(1.2,t)+.02)}noise(e,t,n){let r=this.context,i=this.master;if(r===null||i===null)return;let a=Math.max(1,Math.floor(r.sampleRate*Math.min(.4,e))),o=r.createBuffer(1,a,r.sampleRate),s=o.getChannelData(0),c=a;for(let e=0;e<s.length;e+=1)c=c*16807%2147483647,s[e]=c/1073741824-1;let l=r.createBufferSource(),u=r.createBiquadFilter(),d=r.createGain();l.buffer=o,u.type=`lowpass`,u.frequency.value=Math.max(60,Math.min(1200,t)),d.gain.setValueAtTime(Math.min(.35,n),r.currentTime),d.gain.exponentialRampToValueAtTime(1e-4,r.currentTime+Math.min(.4,e)),l.connect(u).connect(d).connect(i),l.start()}crowdBed(){let e=this.context,t=this.master;if(e===null||t===null)return;let n=e.createOscillator(),r=e.createGain();n.type=`sine`,n.frequency.value=42,r.gain.value=.012,n.connect(r).connect(t),n.start(),n.stop(e.currentTime+8)}destroy(){this.destroyed=!0,window.removeEventListener(`pointerdown`,this.unlockListener),window.removeEventListener(`keydown`,this.unlockListener),document.removeEventListener(`visibilitychange`,this.visibility);for(let e of this.timers)clearTimeout(e);this.timers.clear();let e=this.context;this.context=null,this.master=null,this.unlocked=!1,e!==null&&e.close().catch(()=>void 0)}},r=class extends Error{name=`ProtocolError`},i=2147483647,a=new TextEncoder;function o(e){let t=0,n=()=>{for(;/\s/u.test(e[t]??``);)t+=1},i=()=>{let n=t;if(e[t++]!==`"`)throw new r(`invalid JSON`);for(;t<e.length;){let i=e[t++];if(i===`"`)try{return JSON.parse(e.slice(n,t))}catch{throw new r(`invalid JSON`)}if(i===`\\`){t+=1;continue}if(i!==void 0&&i.charCodeAt(0)<32)throw new r(`invalid JSON`)}throw new r(`invalid JSON`)},a=()=>{n();let o=e[t];if(o===`{`){t+=1,n();let o=new Set;if(e[t]===`}`){t+=1;return}for(;;){n();let s=i();if(o.has(s))throw new r(`duplicate field ${s}`);if(o.add(s),n(),e[t++]!==`:`)throw new r(`invalid JSON`);a(),n();let c=e[t++];if(c===`}`)return;if(c!==`,`)throw new r(`invalid JSON`)}}if(o===`[`){if(t+=1,n(),e[t]===`]`){t+=1;return}for(;;){a(),n();let i=e[t++];if(i===`]`)return;if(i!==`,`)throw new r(`invalid JSON`)}}if(o===`"`){i();return}let s=e.slice(t),c=/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u.exec(s);if(!c)throw new r(`invalid JSON`);t+=c[0].length};if(a(),n(),t!==e.length)throw new r(`invalid JSON`)}function s(e){let t,n;if(typeof e==`string`?(t=a.encode(e),n=e):(t=e instanceof Uint8Array?e:new Uint8Array(e),n=new TextDecoder(`utf-8`,{fatal:!0}).decode(t)),t.byteLength>65536)throw new r(`server frame too large`);try{return o(n),JSON.parse(n)}catch(e){throw e instanceof r?e:new r(`invalid JSON`)}}function c(e,t){if(typeof e!=`object`||!e||Array.isArray(e)||Object.getPrototypeOf(e)!==Object.prototype)throw new r(`${t} must be an object`);return e}function l(e,t,n=[]){let i=new Set([...t,...n]),a=Object.keys(e);if(t.some(t=>!Object.hasOwn(e,t))||a.some(e=>!i.has(e)))throw new r(`schema mismatch`)}function u(e,t,n=0,a=i){if(!Number.isSafeInteger(e)||e<n||e>a)throw new r(`${t} must be a bounded integer`);return e}function d(e,t){if(typeof e!=`boolean`)throw new r(`${t} must be boolean`);return e}function f(e,t,n=255,i=1){if(typeof e!=`string`||e.length<i||e.length>n||/[\u0000-\u001f\u007f]/u.test(e))throw new r(`${t} must be a bounded string`);return e}function p(e,t,n=255){return e===null?null:f(e,t,n)}function m(e,t,n){if(typeof e!=`string`||!t.includes(e))throw new r(`invalid ${n}`);return e}function h(e,t,n){if(!Array.isArray(e)||e.length>n)throw new r(`${t} must be a bounded array`);return e}var g=[`left`,`right`],_=[`jab`,`straight`,`hook`,`uppercut`],v=[`head`,`body`],y=[`normal`,`power`],b=[`orthodox`,`southpaw`],x=[`none`,`guard_high`,`guard_low`,`slip_left`,`slip_right`,`weave`,`pull`],S=[`none`,`guard_high`,`guard_low`],C=[`slip_left`,`slip_right`,`weave`,`pull`,`clinch`,`switch_stance`,`get_up_left`,`get_up_right`],w=[`low_blow`,`headbutt`],T=[`countdown`,`fight`,`knockdown`,`foul_recovery`,`rest`,`complete`],E=[`ko`,`flash_ko`,`tko`,`doctor_stoppage`,`disqualification`,`decision`,`draw`,`forfeit`];function D(e){let t=c(e,`player`);return l(t,[`id`,`name`,`avatar`,`rating`,`connected`]),{id:f(t.id,`player.id`),name:f(t.name,`player.name`,80),avatar:p(t.avatar,`player.avatar`,128),rating:u(t.rating,`rating`),connected:d(t.connected,`connected`)}}function O(e,t){let n=h(e,`players`,2).map(D);if(n.length<1||t!==void 0&&n.length!==t||new Set(n.map(e=>e.id)).size!==n.length)throw new r(`players must be present and distinct`);return n}function ee(e){let t=c(e,`trauma`);return l(t,[`head`,`body`,`left_eye`,`right_eye`,`left_cut`,`right_cut`,`swelling`,`bleeding`]),{head:u(t.head,`head`,0,1400),body:u(t.body,`body`,0,1200),left_eye:u(t.left_eye,`left_eye`,0,1e3),right_eye:u(t.right_eye,`right_eye`,0,1e3),left_cut:u(t.left_cut,`left_cut`,0,1e3),right_cut:u(t.right_cut,`right_cut`,0,1e3),swelling:u(t.swelling,`swelling`,0,1e3),bleeding:u(t.bleeding,`bleeding`,0,1e3)}}function k(e){let t=c(e,`fighter`);l(t,`player_id.x.y.facing.velocity_x.velocity_y.stance.defense.stamina.maximum_stamina.conditioning.guard.poise.trauma.knockdowns.warnings.deductions.stunned_ticks.is_downed.action.action_hand.action_target.action_power.queued_actions.clinch_startup_ticks.clinch_ticks.is_foul_recovery_target.get_up_prompt.get_up_meter.get_up_required.get_up_count.get_up_window_start_tick.get_up_window_end_tick`.split(`.`));let n=t.action===null?null:m(t.action,_,`action`),i=t.action_hand===null?null:m(t.action_hand,g,`action hand`),a=t.action_target===null?null:m(t.action_target,v,`action target`),o=t.action_power===null?null:m(t.action_power,y,`action power`);if([n,i,a,o].some(e=>e===null)&&[n,i,a,o].some(e=>e!==null))throw new r(`partial punch action`);let s=t.get_up_prompt===null?null:m(t.get_up_prompt,[`get_up_left`,`get_up_right`],`get-up prompt`),p=u(t.maximum_stamina,`maximum_stamina`,330,1e3),h=u(t.stamina,`stamina`,0,p),S=u(t.get_up_required,`get_up_required`,0,169),C=u(t.facing,`facing`,-1,1);if(C===0)throw new r(`invalid facing`);if(S!==0&&S<45)throw new r(`invalid get-up requirement`);return{player_id:f(t.player_id,`player_id`),x:u(t.x,`x`,-462,462),y:u(t.y,`y`,-292,292),facing:C,velocity_x:u(t.velocity_x,`velocity_x`,-7,7),velocity_y:u(t.velocity_y,`velocity_y`,-7,7),stance:m(t.stance,b,`stance`),defense:m(t.defense,x,`defense`),stamina:h,maximum_stamina:p,conditioning:u(t.conditioning,`conditioning`,0,1e3),guard:u(t.guard,`guard`,0,700),poise:u(t.poise,`poise`,0,600),trauma:ee(t.trauma),knockdowns:u(t.knockdowns,`knockdowns`,0,3),warnings:u(t.warnings,`warnings`,0,3),deductions:u(t.deductions,`deductions`,0,1),stunned_ticks:u(t.stunned_ticks,`stunned_ticks`,0,90),is_downed:d(t.is_downed,`is_downed`),action:n,action_hand:i,action_target:a,action_power:o,queued_actions:u(t.queued_actions,`queued_actions`,0,1),clinch_startup_ticks:u(t.clinch_startup_ticks,`clinch_startup_ticks`,0,8),clinch_ticks:u(t.clinch_ticks,`clinch_ticks`,0,45),is_foul_recovery_target:d(t.is_foul_recovery_target,`is_foul_recovery_target`),get_up_prompt:s,get_up_meter:u(t.get_up_meter,`get_up_meter`,0,256),get_up_required:S,get_up_count:u(t.get_up_count,`get_up_count`,0,10),get_up_window_start_tick:u(t.get_up_window_start_tick,`get_up_window_start_tick`),get_up_window_end_tick:u(t.get_up_window_end_tick,`get_up_window_end_tick`)}}function te(e){let t=c(e,`event`);return l(t,[`event_id`,`tick`,`kind`,`actor_id`,`target_id`,`amount`,`detail`,`blood`,`direction`]),{event_id:u(t.event_id,`event_id`),tick:u(t.tick,`tick`),kind:f(t.kind,`event kind`,32),actor_id:p(t.actor_id,`actor_id`),target_id:p(t.target_id,`target_id`),amount:u(t.amount,`amount`,-1e4,1e4),detail:f(t.detail,`detail`,96,0),blood:u(t.blood,`blood`,0,100),direction:u(t.direction,`direction`,-1,1)}}function ne(e){let t=c(e,`judge card`);l(t,[`judge`,`player_one`,`player_two`]);let n=e=>h(e,`round scores`,15).map(e=>u(e,`score`,6,10)),i=n(t.player_one),a=n(t.player_two);if(i.length!==a.length)throw new r(`scorecard round mismatch`);return{judge:f(t.judge,`judge`,80),player_one:i,player_two:a}}function A(e){let t=h(e,`scorecards`,3).map(ne);if(t.length!==3)throw new r(`exactly three scorecards required`);return t}function re(e,t){if(t===`draw`!=(e===null))throw new r(`incoherent finish result`)}function ie(e){let t=c(e,`result`);l(t,[`match_id`,`activity_instance_id`,`guild_id`,`player_one_id`,`player_two_id`,`winner_id`,`finish_method`,`round_number`,`tick`,`scorecards`,`player_one_knockdowns`,`player_two_knockdowns`,`player_one_damage`,`player_two_damage`]);let n=f(t.player_one_id,`player_one_id`),i=f(t.player_two_id,`player_two_id`);if(n===i)throw new r(`result players must be distinct`);let a=p(t.winner_id,`winner_id`);if(a!==null&&a!==n&&a!==i)throw new r(`invalid winner`);let o=m(t.finish_method,E,`finish method`);return re(a,o),{match_id:f(t.match_id,`match_id`),activity_instance_id:f(t.activity_instance_id,`activity_instance_id`),guild_id:f(t.guild_id,`guild_id`),player_one_id:n,player_two_id:i,winner_id:a,finish_method:o,round_number:u(t.round_number,`round`,1,15),tick:u(t.tick,`tick`),scorecards:A(t.scorecards),player_one_knockdowns:u(t.player_one_knockdowns,`knockdowns`,0,3),player_two_knockdowns:u(t.player_two_knockdowns,`knockdowns`,0,3),player_one_damage:u(t.player_one_damage,`damage`),player_two_damage:u(t.player_two_damage,`damage`)}}function ae(e){let t=c(e,`snapshot`);l(t,[`tick`,`phase`,`round_number`,`phase_ticks_remaining`,`fighters`,`events`,`result`,`checksum`]);let n=h(t.fighters,`fighters`,2).map(k);if(n.length!==2||n[0]?.player_id===n[1]?.player_id)throw new r(`snapshot requires two distinct fighters`);let i=f(t.checksum,`checksum`,64);if(!/^[a-f0-9]{64}$/u.test(i))throw new r(`invalid checksum`);return{tick:u(t.tick,`tick`),phase:m(t.phase,T,`phase`),round_number:u(t.round_number,`round`,1,15),phase_ticks_remaining:u(t.phase_ticks_remaining,`phase ticks`),fighters:[n[0],n[1]],events:h(t.events,`events`,256).map(te),result:t.result===null?null:ie(t.result),checksum:i}}function oe(e){let t=c(s(e),`envelope`);if(t.version!==1)throw new r(`unsupported protocol version`);let n=f(t.type,`type`,32);if(n===`welcome`){let e=m(t.role,[`fighter`,`spectator`],`connection role`),i=f(t.player_id,`player_id`),a=t.reconnect_ticket===void 0?{}:{reconnect_ticket:f(t.reconnect_ticket,`reconnect_ticket`,4096)};if(e===`fighter`){l(t,[`version`,`type`,`role`,`player_id`,`seat`,`rating`,`players`,`server_tick`,`next_sequence`],[`reconnect_ticket`]);let o=O(t.players);if(!o.some(e=>e.id===i))throw new r(`welcome fighter is absent`);return{version:1,type:n,role:e,player_id:i,seat:u(t.seat,`seat`,1,2),rating:u(t.rating,`rating`),players:o,server_tick:u(t.server_tick,`server_tick`),next_sequence:u(t.next_sequence,`next_sequence`),...a}}l(t,[`version`,`type`,`role`,`player_id`,`players`,`server_tick`],[`reconnect_ticket`]);let o=O(t.players,2);if(o.some(e=>e.id===i))throw new r(`spectator cannot be a fighter`);return{version:1,type:n,role:e,player_id:i,players:[o[0],o[1]],server_tick:u(t.server_tick,`server_tick`),...a}}if(n===`ticket`)return l(t,[`version`,`type`,`reconnect_ticket`,`refresh_id`]),{version:1,type:n,reconnect_ticket:f(t.reconnect_ticket,`reconnect_ticket`,4096),refresh_id:f(t.refresh_id,`refresh_id`,128,16)};if(n===`waiting`){if(l(t,[`version`,`type`,`open_seats`]),t.open_seats!==1)throw new r(`invalid open seats`);return{version:1,type:n,open_seats:1}}if(n===`ready`){l(t,[`version`,`type`,`players`]);let e=O(t.players,2);return{version:1,type:n,players:[e[0],e[1]]}}if(n===`paused`)return l(t,[`version`,`type`,`player_id`,`grace_ms`]),{version:1,type:n,player_id:f(t.player_id,`player_id`),grace_ms:u(t.grace_ms,`grace_ms`,0,6e4)};if(n===`resumed`)return l(t,[`version`,`type`,`player_id`]),{version:1,type:n,player_id:f(t.player_id,`player_id`)};if(n===`snapshot`)return l(t,[`version`,`type`,`payload`]),{version:1,type:n,payload:ae(t.payload)};if(n===`error`)return l(t,[`version`,`type`,`code`]),{version:1,type:n,code:f(t.code,`error code`,80)};if(n===`final`)return j(t,n);throw new r(`unsupported server message type`)}function j(e,t){l(e,[`version`,`type`,`match_id`,`winner_id`,`method`,`round`,`scorecards`,`ratings`]);let n=c(e.ratings,`ratings`),i=Object.entries(n);if(i.length!==2)throw new r(`final requires two ratings`);let a=Object.create(null);for(let[e,t]of i){f(e,`rating player id`);let n=c(t,`rating`);l(n,[`before`,`after`]),a[e]={before:u(n.before,`before`),after:u(n.after,`after`)}}let o=p(e.winner_id,`winner_id`);if(o!==null&&!Object.hasOwn(a,o))throw new r(`winner absent from ratings`);let s=m(e.method,E,`finish method`);return re(o,s),{version:1,type:t,match_id:f(e.match_id,`match_id`),winner_id:o,method:s,round:u(e.round,`round`,1,15),scorecards:A(e.scorecards),ratings:a}}function se(e,t,n){return JSON.stringify({version:1,type:`input`,sequence:u(e,`sequence`),client_tick:u(t,`client tick`),move:{x:Math.max(-1e3,Math.min(1e3,Math.round(Number.isFinite(n.moveX)?n.moveX:0))),y:Math.max(-1e3,Math.min(1e3,Math.round(Number.isFinite(n.moveY)?n.moveY:0)))},defense:m(n.defense,S,`held defense`),actions:n.actions.slice(0,4).map(e=>e.kind===`punch`?{kind:`punch`,hand:m(e.hand,g,`hand`),class:m(e.class,_,`class`),target:m(e.target,v,`target`),power:m(e.power,y,`power`)}:e.kind===`foul`?{kind:`foul`,foul:m(e.foul,w,`foul`)}:{kind:m(e.kind,C,`action`)})})}function ce(e){let t=c(e,`bootstrap`);if(l(t,[`client_id`,`state`,`protocol`,`simulation`]),t.protocol!==1)throw new r(`unsupported protocol version`);let n=c(t.simulation,`simulation`);return l(n,[`tick_rate`,`ring_half_width`,`ring_half_height`]),{client_id:f(t.client_id,`client_id`,36),state:f(t.state,`state`,128),protocol:1,simulation:{tick_rate:u(n.tick_rate,`tick rate`,1,120),ring_half_width:u(n.ring_half_width,`ring width`,1),ring_half_height:u(n.ring_half_height,`ring height`,1)}}}function le(e){let t=c(e,`token response`);l(t,[`access_token`,`ticket`,`player`]);let n=c(t.player,`player`);return l(n,[`id`,`name`,`avatar`,`rating`]),{access_token:f(t.access_token,`access token`,4096),ticket:f(t.ticket,`ticket`,4096),player:{id:f(n.id,`id`),name:f(n.name,`name`,80),avatar:p(n.avatar,`avatar`,128),rating:u(n.rating,`rating`)}}}var M=class extends Error{code;reloadRequired;name=`ClientError`;constructor(e,t=!1){super(e),this.code=e,this.reloadRequired=t}};async function ue(e,t){if(!e.ok)throw new M(e.status===429?`rate_limited`:t);if(!(e.headers.get(`content-type`)??``).toLowerCase().startsWith(`application/json`))throw new M(t);try{return s(await e.text())}catch{throw new M(t)}}function de(e=window.location.search){let t=new URLSearchParams(e).getAll(`instance_id`);if(t.length!==1||!/^[A-Za-z0-9_-]{1,255}$/u.test(t[0]??``))throw new M(`invalid_launch`);return t[0]}async function fe(e,t){let n=new URL(`/api/hands/bootstrap`,window.location.origin);try{return ce(await ue(await fetch(n,{method:`POST`,credentials:`same-origin`,cache:`no-store`,headers:{"Content-Type":`application/json`},body:JSON.stringify({instance_id:e}),...t===void 0?{}:{signal:t}}),`bootstrap_failed`))}catch(e){throw e instanceof M?e:e instanceof r?new M(`invalid_bootstrap`):new M(`bootstrap_failed`)}}async function pe(e,t,n){try{return le(await ue(await fetch(new URL(`/api/hands/token`,window.location.origin),{method:`POST`,credentials:`same-origin`,cache:`no-store`,headers:{"Content-Type":`application/json`},body:JSON.stringify({code:e,state:t}),...n===void 0?{}:{signal:n}}),`token_failed`))}catch(e){throw e instanceof M?e:e instanceof r?new M(`invalid_token_response`):new M(`token_failed`)}}function me(e){return e instanceof M?e.code:e instanceof r?`protocol_error`:`unexpected_error`}var he=typeof globalThis<`u`?globalThis:typeof window<`u`?window:typeof global<`u`?global:typeof self<`u`?self:{};function ge(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,`default`)?e.default:e}var _e={exports:{}},ve;function ye(){return ve?_e.exports:(ve=1,(function(e){var t=Object.prototype.hasOwnProperty,n=`~`;function r(){}Object.create&&(r.prototype=Object.create(null),new r().__proto__||(n=!1));function i(e,t,n){this.fn=e,this.context=t,this.once=n||!1}function a(e,t,r,a,o){if(typeof r!=`function`)throw TypeError(`The listener must be a function`);var s=new i(r,a||e,o),c=n?n+t:t;return e._events[c]?e._events[c].fn?e._events[c]=[e._events[c],s]:e._events[c].push(s):(e._events[c]=s,e._eventsCount++),e}function o(e,t){--e._eventsCount===0?e._events=new r:delete e._events[t]}function s(){this._events=new r,this._eventsCount=0}s.prototype.eventNames=function(){var e=[],r,i;if(this._eventsCount===0)return e;for(i in r=this._events)t.call(r,i)&&e.push(n?i.slice(1):i);return Object.getOwnPropertySymbols?e.concat(Object.getOwnPropertySymbols(r)):e},s.prototype.listeners=function(e){var t=n?n+e:e,r=this._events[t];if(!r)return[];if(r.fn)return[r.fn];for(var i=0,a=r.length,o=Array(a);i<a;i++)o[i]=r[i].fn;return o},s.prototype.listenerCount=function(e){var t=n?n+e:e,r=this._events[t];return r?r.fn?1:r.length:0},s.prototype.emit=function(e,t,r,i,a,o){var s=n?n+e:e;if(!this._events[s])return!1;var c=this._events[s],l=arguments.length,u,d;if(c.fn){switch(c.once&&this.removeListener(e,c.fn,void 0,!0),l){case 1:return c.fn.call(c.context),!0;case 2:return c.fn.call(c.context,t),!0;case 3:return c.fn.call(c.context,t,r),!0;case 4:return c.fn.call(c.context,t,r,i),!0;case 5:return c.fn.call(c.context,t,r,i,a),!0;case 6:return c.fn.call(c.context,t,r,i,a,o),!0}for(d=1,u=Array(l-1);d<l;d++)u[d-1]=arguments[d];c.fn.apply(c.context,u)}else{var f=c.length,p;for(d=0;d<f;d++)switch(c[d].once&&this.removeListener(e,c[d].fn,void 0,!0),l){case 1:c[d].fn.call(c[d].context);break;case 2:c[d].fn.call(c[d].context,t);break;case 3:c[d].fn.call(c[d].context,t,r);break;case 4:c[d].fn.call(c[d].context,t,r,i);break;default:if(!u)for(p=1,u=Array(l-1);p<l;p++)u[p-1]=arguments[p];c[d].fn.apply(c[d].context,u)}}return!0},s.prototype.on=function(e,t,n){return a(this,e,t,n,!1)},s.prototype.once=function(e,t,n){return a(this,e,t,n,!0)},s.prototype.removeListener=function(e,t,r,i){var a=n?n+e:e;if(!this._events[a])return this;if(!t)return o(this,a),this;var s=this._events[a];if(s.fn)s.fn===t&&(!i||s.once)&&(!r||s.context===r)&&o(this,a);else{for(var c=0,l=[],u=s.length;c<u;c++)(s[c].fn!==t||i&&!s[c].once||r&&s[c].context!==r)&&l.push(s[c]);l.length?this._events[a]=l.length===1?l[0]:l:o(this,a)}return this},s.prototype.removeAllListeners=function(e){var t;return e?(t=n?n+e:e,this._events[t]&&o(this,t)):(this._events=new r,this._eventsCount=0),this},s.prototype.off=s.prototype.removeListener,s.prototype.addListener=s.prototype.on,s.prefixed=n,s.EventEmitter=s,e.exports=s})(_e),_e.exports)}var be=ge(ye()),N;(function(e){e.assertEqual=e=>e;function t(e){}e.assertIs=t;function n(e){throw Error()}e.assertNever=n,e.arrayToEnum=e=>{let t={};for(let n of e)t[n]=n;return t},e.getValidEnumValues=t=>{let n=e.objectKeys(t).filter(e=>typeof t[t[e]]!=`number`),r={};for(let e of n)r[e]=t[e];return e.objectValues(r)},e.objectValues=t=>e.objectKeys(t).map(function(e){return t[e]}),e.objectKeys=typeof Object.keys==`function`?e=>Object.keys(e):e=>{let t=[];for(let n in e)Object.prototype.hasOwnProperty.call(e,n)&&t.push(n);return t},e.find=(e,t)=>{for(let n of e)if(t(n))return n},e.isInteger=typeof Number.isInteger==`function`?e=>Number.isInteger(e):e=>typeof e==`number`&&isFinite(e)&&Math.floor(e)===e;function r(e,t=` | `){return e.map(e=>typeof e==`string`?`'${e}'`:e).join(t)}e.joinValues=r,e.jsonStringifyReplacer=(e,t)=>typeof t==`bigint`?t.toString():t})(N||={});var xe;(function(e){e.mergeShapes=(e,t)=>({...e,...t})})(xe||={});var P=N.arrayToEnum([`string`,`nan`,`number`,`integer`,`float`,`boolean`,`date`,`bigint`,`symbol`,`function`,`undefined`,`null`,`array`,`object`,`unknown`,`promise`,`void`,`never`,`map`,`set`]),Se=e=>{switch(typeof e){case`undefined`:return P.undefined;case`string`:return P.string;case`number`:return isNaN(e)?P.nan:P.number;case`boolean`:return P.boolean;case`function`:return P.function;case`bigint`:return P.bigint;case`symbol`:return P.symbol;case`object`:return Array.isArray(e)?P.array:e===null?P.null:e.then&&typeof e.then==`function`&&e.catch&&typeof e.catch==`function`?P.promise:typeof Map<`u`&&e instanceof Map?P.map:typeof Set<`u`&&e instanceof Set?P.set:typeof Date<`u`&&e instanceof Date?P.date:P.object;default:return P.unknown}},F=N.arrayToEnum([`invalid_type`,`invalid_literal`,`custom`,`invalid_union`,`invalid_union_discriminator`,`invalid_enum_value`,`unrecognized_keys`,`invalid_arguments`,`invalid_return_type`,`invalid_date`,`invalid_string`,`too_small`,`too_big`,`invalid_intersection_types`,`not_multiple_of`,`not_finite`]),Ce=e=>JSON.stringify(e,null,2).replace(/"([^"]+)":/g,`$1:`),we=class e extends Error{constructor(e){super(),this.issues=[],this.addIssue=e=>{this.issues=[...this.issues,e]},this.addIssues=(e=[])=>{this.issues=[...this.issues,...e]};let t=new.target.prototype;Object.setPrototypeOf?Object.setPrototypeOf(this,t):this.__proto__=t,this.name=`ZodError`,this.issues=e}get errors(){return this.issues}format(e){let t=e||function(e){return e.message},n={_errors:[]},r=e=>{for(let i of e.issues)if(i.code===`invalid_union`)i.unionErrors.map(r);else if(i.code===`invalid_return_type`)r(i.returnTypeError);else if(i.code===`invalid_arguments`)r(i.argumentsError);else if(i.path.length===0)n._errors.push(t(i));else{let e=n,r=0;for(;r<i.path.length;){let n=i.path[r];r===i.path.length-1?(e[n]=e[n]||{_errors:[]},e[n]._errors.push(t(i))):e[n]=e[n]||{_errors:[]},e=e[n],r++}}};return r(this),n}static assert(t){if(!(t instanceof e))throw Error(`Not a ZodError: ${t}`)}toString(){return this.message}get message(){return JSON.stringify(this.issues,N.jsonStringifyReplacer,2)}get isEmpty(){return this.issues.length===0}flatten(e=e=>e.message){let t={},n=[];for(let r of this.issues)r.path.length>0?(t[r.path[0]]=t[r.path[0]]||[],t[r.path[0]].push(e(r))):n.push(e(r));return{formErrors:n,fieldErrors:t}}get formErrors(){return this.flatten()}};we.create=e=>new we(e);var Te=(e,t)=>{let n;switch(e.code){case F.invalid_type:n=e.received===P.undefined?`Required`:`Expected ${e.expected}, received ${e.received}`;break;case F.invalid_literal:n=`Invalid literal value, expected ${JSON.stringify(e.expected,N.jsonStringifyReplacer)}`;break;case F.unrecognized_keys:n=`Unrecognized key(s) in object: ${N.joinValues(e.keys,`, `)}`;break;case F.invalid_union:n=`Invalid input`;break;case F.invalid_union_discriminator:n=`Invalid discriminator value. Expected ${N.joinValues(e.options)}`;break;case F.invalid_enum_value:n=`Invalid enum value. Expected ${N.joinValues(e.options)}, received '${e.received}'`;break;case F.invalid_arguments:n=`Invalid function arguments`;break;case F.invalid_return_type:n=`Invalid function return type`;break;case F.invalid_date:n=`Invalid date`;break;case F.invalid_string:typeof e.validation==`object`?`includes`in e.validation?(n=`Invalid input: must include "${e.validation.includes}"`,typeof e.validation.position==`number`&&(n=`${n} at one or more positions greater than or equal to ${e.validation.position}`)):`startsWith`in e.validation?n=`Invalid input: must start with "${e.validation.startsWith}"`:`endsWith`in e.validation?n=`Invalid input: must end with "${e.validation.endsWith}"`:N.assertNever(e.validation):n=e.validation===`regex`?`Invalid`:`Invalid ${e.validation}`;break;case F.too_small:n=e.type===`array`?`Array must contain ${e.exact?`exactly`:e.inclusive?`at least`:`more than`} ${e.minimum} element(s)`:e.type===`string`?`String must contain ${e.exact?`exactly`:e.inclusive?`at least`:`over`} ${e.minimum} character(s)`:e.type===`number`?`Number must be ${e.exact?`exactly equal to `:e.inclusive?`greater than or equal to `:`greater than `}${e.minimum}`:e.type===`date`?`Date must be ${e.exact?`exactly equal to `:e.inclusive?`greater than or equal to `:`greater than `}${new Date(Number(e.minimum))}`:`Invalid input`;break;case F.too_big:n=e.type===`array`?`Array must contain ${e.exact?`exactly`:e.inclusive?`at most`:`less than`} ${e.maximum} element(s)`:e.type===`string`?`String must contain ${e.exact?`exactly`:e.inclusive?`at most`:`under`} ${e.maximum} character(s)`:e.type===`number`?`Number must be ${e.exact?`exactly`:e.inclusive?`less than or equal to`:`less than`} ${e.maximum}`:e.type===`bigint`?`BigInt must be ${e.exact?`exactly`:e.inclusive?`less than or equal to`:`less than`} ${e.maximum}`:e.type===`date`?`Date must be ${e.exact?`exactly`:e.inclusive?`smaller than or equal to`:`smaller than`} ${new Date(Number(e.maximum))}`:`Invalid input`;break;case F.custom:n=`Invalid input`;break;case F.invalid_intersection_types:n=`Intersection results could not be merged`;break;case F.not_multiple_of:n=`Number must be a multiple of ${e.multipleOf}`;break;case F.not_finite:n=`Number must be finite`;break;default:n=t.defaultError,N.assertNever(e)}return{message:n}},I=Te;function Ee(e){I=e}function L(){return I}var De=e=>{let{data:t,path:n,errorMaps:r,issueData:i}=e,a=[...n,...i.path||[]],o={...i,path:a};if(i.message!==void 0)return{...i,path:a,message:i.message};let s=``,c=r.filter(e=>!!e).slice().reverse();for(let e of c)s=e(o,{data:t,defaultError:s}).message;return{...i,path:a,message:s}},Oe=[];function R(e,t){let n=L(),r=De({issueData:t,data:e.data,path:e.path,errorMaps:[e.common.contextualErrorMap,e.schemaErrorMap,n,n===Te?void 0:Te].filter(e=>!!e)});e.common.issues.push(r)}var ke=class e{constructor(){this.value=`valid`}dirty(){this.value===`valid`&&(this.value=`dirty`)}abort(){this.value!==`aborted`&&(this.value=`aborted`)}static mergeArray(e,t){let n=[];for(let r of t){if(r.status===`aborted`)return z;r.status===`dirty`&&e.dirty(),n.push(r.value)}return{status:e.value,value:n}}static async mergeObjectAsync(t,n){let r=[];for(let e of n){let t=await e.key,n=await e.value;r.push({key:t,value:n})}return e.mergeObjectSync(t,r)}static mergeObjectSync(e,t){let n={};for(let r of t){let{key:t,value:i}=r;if(t.status===`aborted`||i.status===`aborted`)return z;t.status===`dirty`&&e.dirty(),i.status===`dirty`&&e.dirty(),t.value!==`__proto__`&&(i.value!==void 0||r.alwaysSet)&&(n[t.value]=i.value)}return{status:e.value,value:n}}},z=Object.freeze({status:`aborted`}),Ae=e=>({status:`dirty`,value:e}),je=e=>({status:`valid`,value:e}),Me=e=>e.status===`aborted`,Ne=e=>e.status===`dirty`,Pe=e=>e.status===`valid`,Fe=e=>typeof Promise<`u`&&e instanceof Promise;function Ie(e,t,n,r){if(typeof t==`function`?e!==t||!r:!t.has(e))throw TypeError(`Cannot read private member from an object whose class did not declare it`);return t.get(e)}function Le(e,t,n,r,i){if(typeof t==`function`?e!==t||!i:!t.has(e))throw TypeError(`Cannot write private member to an object whose class did not declare it`);return t.set(e,n),n}var B;(function(e){e.errToObj=e=>typeof e==`string`?{message:e}:e||{},e.toString=e=>typeof e==`string`?e:e?.message})(B||={});var Re,ze,Be=class{constructor(e,t,n,r){this._cachedPath=[],this.parent=e,this.data=t,this._path=n,this._key=r}get path(){return this._cachedPath.length||(this._key instanceof Array?this._cachedPath.push(...this._path,...this._key):this._cachedPath.push(...this._path,this._key)),this._cachedPath}},Ve=(e,t)=>{if(Pe(t))return{success:!0,data:t.value};if(!e.common.issues.length)throw Error(`Validation failed but no issues detected.`);return{success:!1,get error(){if(this._error)return this._error;let t=new we(e.common.issues);return this._error=t,this._error}}};function He(e){if(!e)return{};let{errorMap:t,invalid_type_error:n,required_error:r,description:i}=e;if(t&&(n||r))throw Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);return t?{errorMap:t,description:i}:{errorMap:(t,i)=>{let{message:a}=e;return t.code===`invalid_enum_value`?{message:a??i.defaultError}:i.data===void 0?{message:a??r??i.defaultError}:t.code===`invalid_type`?{message:a??n??i.defaultError}:{message:i.defaultError}},description:i}}var V=class{constructor(e){this.spa=this.safeParseAsync,this._def=e,this.parse=this.parse.bind(this),this.safeParse=this.safeParse.bind(this),this.parseAsync=this.parseAsync.bind(this),this.safeParseAsync=this.safeParseAsync.bind(this),this.spa=this.spa.bind(this),this.refine=this.refine.bind(this),this.refinement=this.refinement.bind(this),this.superRefine=this.superRefine.bind(this),this.optional=this.optional.bind(this),this.nullable=this.nullable.bind(this),this.nullish=this.nullish.bind(this),this.array=this.array.bind(this),this.promise=this.promise.bind(this),this.or=this.or.bind(this),this.and=this.and.bind(this),this.transform=this.transform.bind(this),this.brand=this.brand.bind(this),this.default=this.default.bind(this),this.catch=this.catch.bind(this),this.describe=this.describe.bind(this),this.pipe=this.pipe.bind(this),this.readonly=this.readonly.bind(this),this.isNullable=this.isNullable.bind(this),this.isOptional=this.isOptional.bind(this)}get description(){return this._def.description}_getType(e){return Se(e.data)}_getOrReturnCtx(e,t){return t||{common:e.parent.common,data:e.data,parsedType:Se(e.data),schemaErrorMap:this._def.errorMap,path:e.path,parent:e.parent}}_processInputParams(e){return{status:new ke,ctx:{common:e.parent.common,data:e.data,parsedType:Se(e.data),schemaErrorMap:this._def.errorMap,path:e.path,parent:e.parent}}}_parseSync(e){let t=this._parse(e);if(Fe(t))throw Error(`Synchronous parse encountered promise.`);return t}_parseAsync(e){let t=this._parse(e);return Promise.resolve(t)}parse(e,t){let n=this.safeParse(e,t);if(n.success)return n.data;throw n.error}safeParse(e,t){let n={common:{issues:[],async:t?.async??!1,contextualErrorMap:t?.errorMap},path:t?.path||[],schemaErrorMap:this._def.errorMap,parent:null,data:e,parsedType:Se(e)};return Ve(n,this._parseSync({data:e,path:n.path,parent:n}))}async parseAsync(e,t){let n=await this.safeParseAsync(e,t);if(n.success)return n.data;throw n.error}async safeParseAsync(e,t){let n={common:{issues:[],contextualErrorMap:t?.errorMap,async:!0},path:t?.path||[],schemaErrorMap:this._def.errorMap,parent:null,data:e,parsedType:Se(e)},r=this._parse({data:e,path:n.path,parent:n});return Ve(n,await(Fe(r)?r:Promise.resolve(r)))}refine(e,t){let n=e=>typeof t==`string`||t===void 0?{message:t}:typeof t==`function`?t(e):t;return this._refinement((t,r)=>{let i=e(t),a=()=>r.addIssue({code:F.custom,...n(t)});return typeof Promise<`u`&&i instanceof Promise?i.then(e=>e?!0:(a(),!1)):i?!0:(a(),!1)})}refinement(e,t){return this._refinement((n,r)=>e(n)?!0:(r.addIssue(typeof t==`function`?t(n,r):t),!1))}_refinement(e){return new zt({schema:this,typeName:Zt.ZodEffects,effect:{type:`refinement`,refinement:e}})}superRefine(e){return this._refinement(e)}optional(){return Bt.create(this,this._def)}nullable(){return Vt.create(this,this._def)}nullish(){return this.nullable().optional()}array(){return bt.create(this,this._def)}promise(){return Rt.create(this,this._def)}or(e){return Ct.create([this,e],this._def)}and(e){return Dt.create(this,e,this._def)}transform(e){return new zt({...He(this._def),schema:this,typeName:Zt.ZodEffects,effect:{type:`transform`,transform:e}})}default(e){let t=typeof e==`function`?e:()=>e;return new Ht({...He(this._def),innerType:this,defaultValue:t,typeName:Zt.ZodDefault})}brand(){return new Kt({typeName:Zt.ZodBranded,type:this,...He(this._def)})}catch(e){let t=typeof e==`function`?e:()=>e;return new Ut({...He(this._def),innerType:this,catchValue:t,typeName:Zt.ZodCatch})}describe(e){let t=this.constructor;return new t({...this._def,description:e})}pipe(e){return qt.create(this,e)}readonly(){return Jt.create(this)}isOptional(){return this.safeParse(void 0).success}isNullable(){return this.safeParse(null).success}},Ue=/^c[^\s-]{8,}$/i,We=/^[0-9a-z]+$/,Ge=/^[0-9A-HJKMNP-TV-Z]{26}$/,Ke=/^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i,qe=/^[a-z0-9_-]{21}$/i,Je=/^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/,Ye=/^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i,Xe=`^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`,Ze,Qe=/^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,$e=/^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/,et=/^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/,tt=`((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`,nt=RegExp(`^${tt}$`);function rt(e){let t=`([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d`;return e.precision?t=`${t}\\.\\d{${e.precision}}`:e.precision??(t=`${t}(\\.\\d+)?`),t}function it(e){return RegExp(`^${rt(e)}$`)}function at(e){let t=`${tt}T${rt(e)}`,n=[];return n.push(e.local?`Z?`:`Z`),e.offset&&n.push(`([+-]\\d{2}:?\\d{2})`),t=`${t}(${n.join(`|`)})`,RegExp(`^${t}$`)}function ot(e,t){return!!((t===`v4`||!t)&&Qe.test(e)||(t===`v6`||!t)&&$e.test(e))}var st=class e extends V{_parse(e){if(this._def.coerce&&(e.data=String(e.data)),this._getType(e)!==P.string){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.string,received:t.parsedType}),z}let t=new ke,n;for(let r of this._def.checks)if(r.kind===`min`)e.data.length<r.value&&(n=this._getOrReturnCtx(e,n),R(n,{code:F.too_small,minimum:r.value,type:`string`,inclusive:!0,exact:!1,message:r.message}),t.dirty());else if(r.kind===`max`)e.data.length>r.value&&(n=this._getOrReturnCtx(e,n),R(n,{code:F.too_big,maximum:r.value,type:`string`,inclusive:!0,exact:!1,message:r.message}),t.dirty());else if(r.kind===`length`){let i=e.data.length>r.value,a=e.data.length<r.value;(i||a)&&(n=this._getOrReturnCtx(e,n),i?R(n,{code:F.too_big,maximum:r.value,type:`string`,inclusive:!0,exact:!0,message:r.message}):a&&R(n,{code:F.too_small,minimum:r.value,type:`string`,inclusive:!0,exact:!0,message:r.message}),t.dirty())}else if(r.kind===`email`)Ye.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`email`,code:F.invalid_string,message:r.message}),t.dirty());else if(r.kind===`emoji`)Ze||=new RegExp(Xe,`u`),Ze.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`emoji`,code:F.invalid_string,message:r.message}),t.dirty());else if(r.kind===`uuid`)Ke.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`uuid`,code:F.invalid_string,message:r.message}),t.dirty());else if(r.kind===`nanoid`)qe.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`nanoid`,code:F.invalid_string,message:r.message}),t.dirty());else if(r.kind===`cuid`)Ue.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`cuid`,code:F.invalid_string,message:r.message}),t.dirty());else if(r.kind===`cuid2`)We.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`cuid2`,code:F.invalid_string,message:r.message}),t.dirty());else if(r.kind===`ulid`)Ge.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`ulid`,code:F.invalid_string,message:r.message}),t.dirty());else if(r.kind===`url`)try{new URL(e.data)}catch{n=this._getOrReturnCtx(e,n),R(n,{validation:`url`,code:F.invalid_string,message:r.message}),t.dirty()}else r.kind===`regex`?(r.regex.lastIndex=0,r.regex.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`regex`,code:F.invalid_string,message:r.message}),t.dirty())):r.kind===`trim`?e.data=e.data.trim():r.kind===`includes`?e.data.includes(r.value,r.position)||(n=this._getOrReturnCtx(e,n),R(n,{code:F.invalid_string,validation:{includes:r.value,position:r.position},message:r.message}),t.dirty()):r.kind===`toLowerCase`?e.data=e.data.toLowerCase():r.kind===`toUpperCase`?e.data=e.data.toUpperCase():r.kind===`startsWith`?e.data.startsWith(r.value)||(n=this._getOrReturnCtx(e,n),R(n,{code:F.invalid_string,validation:{startsWith:r.value},message:r.message}),t.dirty()):r.kind===`endsWith`?e.data.endsWith(r.value)||(n=this._getOrReturnCtx(e,n),R(n,{code:F.invalid_string,validation:{endsWith:r.value},message:r.message}),t.dirty()):r.kind===`datetime`?at(r).test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{code:F.invalid_string,validation:`datetime`,message:r.message}),t.dirty()):r.kind===`date`?nt.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{code:F.invalid_string,validation:`date`,message:r.message}),t.dirty()):r.kind===`time`?it(r).test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{code:F.invalid_string,validation:`time`,message:r.message}),t.dirty()):r.kind===`duration`?Je.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`duration`,code:F.invalid_string,message:r.message}),t.dirty()):r.kind===`ip`?ot(e.data,r.version)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`ip`,code:F.invalid_string,message:r.message}),t.dirty()):r.kind===`base64`?et.test(e.data)||(n=this._getOrReturnCtx(e,n),R(n,{validation:`base64`,code:F.invalid_string,message:r.message}),t.dirty()):N.assertNever(r);return{status:t.value,value:e.data}}_regex(e,t,n){return this.refinement(t=>e.test(t),{validation:t,code:F.invalid_string,...B.errToObj(n)})}_addCheck(t){return new e({...this._def,checks:[...this._def.checks,t]})}email(e){return this._addCheck({kind:`email`,...B.errToObj(e)})}url(e){return this._addCheck({kind:`url`,...B.errToObj(e)})}emoji(e){return this._addCheck({kind:`emoji`,...B.errToObj(e)})}uuid(e){return this._addCheck({kind:`uuid`,...B.errToObj(e)})}nanoid(e){return this._addCheck({kind:`nanoid`,...B.errToObj(e)})}cuid(e){return this._addCheck({kind:`cuid`,...B.errToObj(e)})}cuid2(e){return this._addCheck({kind:`cuid2`,...B.errToObj(e)})}ulid(e){return this._addCheck({kind:`ulid`,...B.errToObj(e)})}base64(e){return this._addCheck({kind:`base64`,...B.errToObj(e)})}ip(e){return this._addCheck({kind:`ip`,...B.errToObj(e)})}datetime(e){return typeof e==`string`?this._addCheck({kind:`datetime`,precision:null,offset:!1,local:!1,message:e}):this._addCheck({kind:`datetime`,precision:e?.precision===void 0?null:e?.precision,offset:e?.offset??!1,local:e?.local??!1,...B.errToObj(e?.message)})}date(e){return this._addCheck({kind:`date`,message:e})}time(e){return typeof e==`string`?this._addCheck({kind:`time`,precision:null,message:e}):this._addCheck({kind:`time`,precision:e?.precision===void 0?null:e?.precision,...B.errToObj(e?.message)})}duration(e){return this._addCheck({kind:`duration`,...B.errToObj(e)})}regex(e,t){return this._addCheck({kind:`regex`,regex:e,...B.errToObj(t)})}includes(e,t){return this._addCheck({kind:`includes`,value:e,position:t?.position,...B.errToObj(t?.message)})}startsWith(e,t){return this._addCheck({kind:`startsWith`,value:e,...B.errToObj(t)})}endsWith(e,t){return this._addCheck({kind:`endsWith`,value:e,...B.errToObj(t)})}min(e,t){return this._addCheck({kind:`min`,value:e,...B.errToObj(t)})}max(e,t){return this._addCheck({kind:`max`,value:e,...B.errToObj(t)})}length(e,t){return this._addCheck({kind:`length`,value:e,...B.errToObj(t)})}nonempty(e){return this.min(1,B.errToObj(e))}trim(){return new e({...this._def,checks:[...this._def.checks,{kind:`trim`}]})}toLowerCase(){return new e({...this._def,checks:[...this._def.checks,{kind:`toLowerCase`}]})}toUpperCase(){return new e({...this._def,checks:[...this._def.checks,{kind:`toUpperCase`}]})}get isDatetime(){return!!this._def.checks.find(e=>e.kind===`datetime`)}get isDate(){return!!this._def.checks.find(e=>e.kind===`date`)}get isTime(){return!!this._def.checks.find(e=>e.kind===`time`)}get isDuration(){return!!this._def.checks.find(e=>e.kind===`duration`)}get isEmail(){return!!this._def.checks.find(e=>e.kind===`email`)}get isURL(){return!!this._def.checks.find(e=>e.kind===`url`)}get isEmoji(){return!!this._def.checks.find(e=>e.kind===`emoji`)}get isUUID(){return!!this._def.checks.find(e=>e.kind===`uuid`)}get isNANOID(){return!!this._def.checks.find(e=>e.kind===`nanoid`)}get isCUID(){return!!this._def.checks.find(e=>e.kind===`cuid`)}get isCUID2(){return!!this._def.checks.find(e=>e.kind===`cuid2`)}get isULID(){return!!this._def.checks.find(e=>e.kind===`ulid`)}get isIP(){return!!this._def.checks.find(e=>e.kind===`ip`)}get isBase64(){return!!this._def.checks.find(e=>e.kind===`base64`)}get minLength(){let e=null;for(let t of this._def.checks)t.kind===`min`&&(e===null||t.value>e)&&(e=t.value);return e}get maxLength(){let e=null;for(let t of this._def.checks)t.kind===`max`&&(e===null||t.value<e)&&(e=t.value);return e}};st.create=e=>new st({checks:[],typeName:Zt.ZodString,coerce:e?.coerce??!1,...He(e)});function ct(e,t){let n=(e.toString().split(`.`)[1]||``).length,r=(t.toString().split(`.`)[1]||``).length,i=n>r?n:r;return parseInt(e.toFixed(i).replace(`.`,``))%parseInt(t.toFixed(i).replace(`.`,``))/10**i}var lt=class e extends V{constructor(){super(...arguments),this.min=this.gte,this.max=this.lte,this.step=this.multipleOf}_parse(e){if(this._def.coerce&&(e.data=Number(e.data)),this._getType(e)!==P.number){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.number,received:t.parsedType}),z}let t,n=new ke;for(let r of this._def.checks)r.kind===`int`?N.isInteger(e.data)||(t=this._getOrReturnCtx(e,t),R(t,{code:F.invalid_type,expected:`integer`,received:`float`,message:r.message}),n.dirty()):r.kind===`min`?(r.inclusive?e.data<r.value:e.data<=r.value)&&(t=this._getOrReturnCtx(e,t),R(t,{code:F.too_small,minimum:r.value,type:`number`,inclusive:r.inclusive,exact:!1,message:r.message}),n.dirty()):r.kind===`max`?(r.inclusive?e.data>r.value:e.data>=r.value)&&(t=this._getOrReturnCtx(e,t),R(t,{code:F.too_big,maximum:r.value,type:`number`,inclusive:r.inclusive,exact:!1,message:r.message}),n.dirty()):r.kind===`multipleOf`?ct(e.data,r.value)!==0&&(t=this._getOrReturnCtx(e,t),R(t,{code:F.not_multiple_of,multipleOf:r.value,message:r.message}),n.dirty()):r.kind===`finite`?Number.isFinite(e.data)||(t=this._getOrReturnCtx(e,t),R(t,{code:F.not_finite,message:r.message}),n.dirty()):N.assertNever(r);return{status:n.value,value:e.data}}gte(e,t){return this.setLimit(`min`,e,!0,B.toString(t))}gt(e,t){return this.setLimit(`min`,e,!1,B.toString(t))}lte(e,t){return this.setLimit(`max`,e,!0,B.toString(t))}lt(e,t){return this.setLimit(`max`,e,!1,B.toString(t))}setLimit(t,n,r,i){return new e({...this._def,checks:[...this._def.checks,{kind:t,value:n,inclusive:r,message:B.toString(i)}]})}_addCheck(t){return new e({...this._def,checks:[...this._def.checks,t]})}int(e){return this._addCheck({kind:`int`,message:B.toString(e)})}positive(e){return this._addCheck({kind:`min`,value:0,inclusive:!1,message:B.toString(e)})}negative(e){return this._addCheck({kind:`max`,value:0,inclusive:!1,message:B.toString(e)})}nonpositive(e){return this._addCheck({kind:`max`,value:0,inclusive:!0,message:B.toString(e)})}nonnegative(e){return this._addCheck({kind:`min`,value:0,inclusive:!0,message:B.toString(e)})}multipleOf(e,t){return this._addCheck({kind:`multipleOf`,value:e,message:B.toString(t)})}finite(e){return this._addCheck({kind:`finite`,message:B.toString(e)})}safe(e){return this._addCheck({kind:`min`,inclusive:!0,value:-(2**53-1),message:B.toString(e)})._addCheck({kind:`max`,inclusive:!0,value:2**53-1,message:B.toString(e)})}get minValue(){let e=null;for(let t of this._def.checks)t.kind===`min`&&(e===null||t.value>e)&&(e=t.value);return e}get maxValue(){let e=null;for(let t of this._def.checks)t.kind===`max`&&(e===null||t.value<e)&&(e=t.value);return e}get isInt(){return!!this._def.checks.find(e=>e.kind===`int`||e.kind===`multipleOf`&&N.isInteger(e.value))}get isFinite(){let e=null,t=null;for(let n of this._def.checks)if(n.kind===`finite`||n.kind===`int`||n.kind===`multipleOf`)return!0;else n.kind===`min`?(t===null||n.value>t)&&(t=n.value):n.kind===`max`&&(e===null||n.value<e)&&(e=n.value);return Number.isFinite(t)&&Number.isFinite(e)}};lt.create=e=>new lt({checks:[],typeName:Zt.ZodNumber,coerce:e?.coerce||!1,...He(e)});var ut=class e extends V{constructor(){super(...arguments),this.min=this.gte,this.max=this.lte}_parse(e){if(this._def.coerce&&(e.data=BigInt(e.data)),this._getType(e)!==P.bigint){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.bigint,received:t.parsedType}),z}let t,n=new ke;for(let r of this._def.checks)r.kind===`min`?(r.inclusive?e.data<r.value:e.data<=r.value)&&(t=this._getOrReturnCtx(e,t),R(t,{code:F.too_small,type:`bigint`,minimum:r.value,inclusive:r.inclusive,message:r.message}),n.dirty()):r.kind===`max`?(r.inclusive?e.data>r.value:e.data>=r.value)&&(t=this._getOrReturnCtx(e,t),R(t,{code:F.too_big,type:`bigint`,maximum:r.value,inclusive:r.inclusive,message:r.message}),n.dirty()):r.kind===`multipleOf`?e.data%r.value!==BigInt(0)&&(t=this._getOrReturnCtx(e,t),R(t,{code:F.not_multiple_of,multipleOf:r.value,message:r.message}),n.dirty()):N.assertNever(r);return{status:n.value,value:e.data}}gte(e,t){return this.setLimit(`min`,e,!0,B.toString(t))}gt(e,t){return this.setLimit(`min`,e,!1,B.toString(t))}lte(e,t){return this.setLimit(`max`,e,!0,B.toString(t))}lt(e,t){return this.setLimit(`max`,e,!1,B.toString(t))}setLimit(t,n,r,i){return new e({...this._def,checks:[...this._def.checks,{kind:t,value:n,inclusive:r,message:B.toString(i)}]})}_addCheck(t){return new e({...this._def,checks:[...this._def.checks,t]})}positive(e){return this._addCheck({kind:`min`,value:BigInt(0),inclusive:!1,message:B.toString(e)})}negative(e){return this._addCheck({kind:`max`,value:BigInt(0),inclusive:!1,message:B.toString(e)})}nonpositive(e){return this._addCheck({kind:`max`,value:BigInt(0),inclusive:!0,message:B.toString(e)})}nonnegative(e){return this._addCheck({kind:`min`,value:BigInt(0),inclusive:!0,message:B.toString(e)})}multipleOf(e,t){return this._addCheck({kind:`multipleOf`,value:e,message:B.toString(t)})}get minValue(){let e=null;for(let t of this._def.checks)t.kind===`min`&&(e===null||t.value>e)&&(e=t.value);return e}get maxValue(){let e=null;for(let t of this._def.checks)t.kind===`max`&&(e===null||t.value<e)&&(e=t.value);return e}};ut.create=e=>new ut({checks:[],typeName:Zt.ZodBigInt,coerce:e?.coerce??!1,...He(e)});var dt=class extends V{_parse(e){if(this._def.coerce&&(e.data=!!e.data),this._getType(e)!==P.boolean){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.boolean,received:t.parsedType}),z}return je(e.data)}};dt.create=e=>new dt({typeName:Zt.ZodBoolean,coerce:e?.coerce||!1,...He(e)});var ft=class e extends V{_parse(e){if(this._def.coerce&&(e.data=new Date(e.data)),this._getType(e)!==P.date){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.date,received:t.parsedType}),z}if(isNaN(e.data.getTime()))return R(this._getOrReturnCtx(e),{code:F.invalid_date}),z;let t=new ke,n;for(let r of this._def.checks)r.kind===`min`?e.data.getTime()<r.value&&(n=this._getOrReturnCtx(e,n),R(n,{code:F.too_small,message:r.message,inclusive:!0,exact:!1,minimum:r.value,type:`date`}),t.dirty()):r.kind===`max`?e.data.getTime()>r.value&&(n=this._getOrReturnCtx(e,n),R(n,{code:F.too_big,message:r.message,inclusive:!0,exact:!1,maximum:r.value,type:`date`}),t.dirty()):N.assertNever(r);return{status:t.value,value:new Date(e.data.getTime())}}_addCheck(t){return new e({...this._def,checks:[...this._def.checks,t]})}min(e,t){return this._addCheck({kind:`min`,value:e.getTime(),message:B.toString(t)})}max(e,t){return this._addCheck({kind:`max`,value:e.getTime(),message:B.toString(t)})}get minDate(){let e=null;for(let t of this._def.checks)t.kind===`min`&&(e===null||t.value>e)&&(e=t.value);return e==null?null:new Date(e)}get maxDate(){let e=null;for(let t of this._def.checks)t.kind===`max`&&(e===null||t.value<e)&&(e=t.value);return e==null?null:new Date(e)}};ft.create=e=>new ft({checks:[],coerce:e?.coerce||!1,typeName:Zt.ZodDate,...He(e)});var pt=class extends V{_parse(e){if(this._getType(e)!==P.symbol){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.symbol,received:t.parsedType}),z}return je(e.data)}};pt.create=e=>new pt({typeName:Zt.ZodSymbol,...He(e)});var mt=class extends V{_parse(e){if(this._getType(e)!==P.undefined){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.undefined,received:t.parsedType}),z}return je(e.data)}};mt.create=e=>new mt({typeName:Zt.ZodUndefined,...He(e)});var ht=class extends V{_parse(e){if(this._getType(e)!==P.null){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.null,received:t.parsedType}),z}return je(e.data)}};ht.create=e=>new ht({typeName:Zt.ZodNull,...He(e)});var gt=class extends V{constructor(){super(...arguments),this._any=!0}_parse(e){return je(e.data)}};gt.create=e=>new gt({typeName:Zt.ZodAny,...He(e)});var _t=class extends V{constructor(){super(...arguments),this._unknown=!0}_parse(e){return je(e.data)}};_t.create=e=>new _t({typeName:Zt.ZodUnknown,...He(e)});var vt=class extends V{_parse(e){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.never,received:t.parsedType}),z}};vt.create=e=>new vt({typeName:Zt.ZodNever,...He(e)});var yt=class extends V{_parse(e){if(this._getType(e)!==P.undefined){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.void,received:t.parsedType}),z}return je(e.data)}};yt.create=e=>new yt({typeName:Zt.ZodVoid,...He(e)});var bt=class e extends V{_parse(e){let{ctx:t,status:n}=this._processInputParams(e),r=this._def;if(t.parsedType!==P.array)return R(t,{code:F.invalid_type,expected:P.array,received:t.parsedType}),z;if(r.exactLength!==null){let e=t.data.length>r.exactLength.value,i=t.data.length<r.exactLength.value;(e||i)&&(R(t,{code:e?F.too_big:F.too_small,minimum:i?r.exactLength.value:void 0,maximum:e?r.exactLength.value:void 0,type:`array`,inclusive:!0,exact:!0,message:r.exactLength.message}),n.dirty())}if(r.minLength!==null&&t.data.length<r.minLength.value&&(R(t,{code:F.too_small,minimum:r.minLength.value,type:`array`,inclusive:!0,exact:!1,message:r.minLength.message}),n.dirty()),r.maxLength!==null&&t.data.length>r.maxLength.value&&(R(t,{code:F.too_big,maximum:r.maxLength.value,type:`array`,inclusive:!0,exact:!1,message:r.maxLength.message}),n.dirty()),t.common.async)return Promise.all([...t.data].map((e,n)=>r.type._parseAsync(new Be(t,e,t.path,n)))).then(e=>ke.mergeArray(n,e));let i=[...t.data].map((e,n)=>r.type._parseSync(new Be(t,e,t.path,n)));return ke.mergeArray(n,i)}get element(){return this._def.type}min(t,n){return new e({...this._def,minLength:{value:t,message:B.toString(n)}})}max(t,n){return new e({...this._def,maxLength:{value:t,message:B.toString(n)}})}length(t,n){return new e({...this._def,exactLength:{value:t,message:B.toString(n)}})}nonempty(e){return this.min(1,e)}};bt.create=(e,t)=>new bt({type:e,minLength:null,maxLength:null,exactLength:null,typeName:Zt.ZodArray,...He(t)});function xt(e){if(e instanceof St){let t={};for(let n in e.shape){let r=e.shape[n];t[n]=Bt.create(xt(r))}return new St({...e._def,shape:()=>t})}else if(e instanceof bt)return new bt({...e._def,type:xt(e.element)});else if(e instanceof Bt)return Bt.create(xt(e.unwrap()));else if(e instanceof Vt)return Vt.create(xt(e.unwrap()));else if(e instanceof Ot)return Ot.create(e.items.map(e=>xt(e)));else return e}var St=class e extends V{constructor(){super(...arguments),this._cached=null,this.nonstrict=this.passthrough,this.augment=this.extend}_getCached(){if(this._cached!==null)return this._cached;let e=this._def.shape(),t=N.objectKeys(e);return this._cached={shape:e,keys:t}}_parse(e){if(this._getType(e)!==P.object){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.object,received:t.parsedType}),z}let{status:t,ctx:n}=this._processInputParams(e),{shape:r,keys:i}=this._getCached(),a=[];if(!(this._def.catchall instanceof vt&&this._def.unknownKeys===`strip`))for(let e in n.data)i.includes(e)||a.push(e);let o=[];for(let e of i){let t=r[e],i=n.data[e];o.push({key:{status:`valid`,value:e},value:t._parse(new Be(n,i,n.path,e)),alwaysSet:e in n.data})}if(this._def.catchall instanceof vt){let e=this._def.unknownKeys;if(e===`passthrough`)for(let e of a)o.push({key:{status:`valid`,value:e},value:{status:`valid`,value:n.data[e]}});else if(e===`strict`)a.length>0&&(R(n,{code:F.unrecognized_keys,keys:a}),t.dirty());else if(e!==`strip`)throw Error(`Internal ZodObject error: invalid unknownKeys value.`)}else{let e=this._def.catchall;for(let t of a){let r=n.data[t];o.push({key:{status:`valid`,value:t},value:e._parse(new Be(n,r,n.path,t)),alwaysSet:t in n.data})}}return n.common.async?Promise.resolve().then(async()=>{let e=[];for(let t of o){let n=await t.key,r=await t.value;e.push({key:n,value:r,alwaysSet:t.alwaysSet})}return e}).then(e=>ke.mergeObjectSync(t,e)):ke.mergeObjectSync(t,o)}get shape(){return this._def.shape()}strict(t){return B.errToObj,new e({...this._def,unknownKeys:`strict`,...t===void 0?{}:{errorMap:(e,n)=>{var r;let i=(r=this._def).errorMap?.call(r,e,n).message??n.defaultError;return e.code===`unrecognized_keys`?{message:B.errToObj(t).message??i}:{message:i}}}})}strip(){return new e({...this._def,unknownKeys:`strip`})}passthrough(){return new e({...this._def,unknownKeys:`passthrough`})}extend(t){return new e({...this._def,shape:()=>({...this._def.shape(),...t})})}merge(t){return new e({unknownKeys:t._def.unknownKeys,catchall:t._def.catchall,shape:()=>({...this._def.shape(),...t._def.shape()}),typeName:Zt.ZodObject})}setKey(e,t){return this.augment({[e]:t})}catchall(t){return new e({...this._def,catchall:t})}pick(t){let n={};return N.objectKeys(t).forEach(e=>{t[e]&&this.shape[e]&&(n[e]=this.shape[e])}),new e({...this._def,shape:()=>n})}omit(t){let n={};return N.objectKeys(this.shape).forEach(e=>{t[e]||(n[e]=this.shape[e])}),new e({...this._def,shape:()=>n})}deepPartial(){return xt(this)}partial(t){let n={};return N.objectKeys(this.shape).forEach(e=>{let r=this.shape[e];t&&!t[e]?n[e]=r:n[e]=r.optional()}),new e({...this._def,shape:()=>n})}required(t){let n={};return N.objectKeys(this.shape).forEach(e=>{if(t&&!t[e])n[e]=this.shape[e];else{let t=this.shape[e];for(;t instanceof Bt;)t=t._def.innerType;n[e]=t}}),new e({...this._def,shape:()=>n})}keyof(){return Ft(N.objectKeys(this.shape))}};St.create=(e,t)=>new St({shape:()=>e,unknownKeys:`strip`,catchall:vt.create(),typeName:Zt.ZodObject,...He(t)}),St.strictCreate=(e,t)=>new St({shape:()=>e,unknownKeys:`strict`,catchall:vt.create(),typeName:Zt.ZodObject,...He(t)}),St.lazycreate=(e,t)=>new St({shape:e,unknownKeys:`strip`,catchall:vt.create(),typeName:Zt.ZodObject,...He(t)});var Ct=class extends V{_parse(e){let{ctx:t}=this._processInputParams(e),n=this._def.options;function r(e){for(let t of e)if(t.result.status===`valid`)return t.result;for(let n of e)if(n.result.status===`dirty`)return t.common.issues.push(...n.ctx.common.issues),n.result;let n=e.map(e=>new we(e.ctx.common.issues));return R(t,{code:F.invalid_union,unionErrors:n}),z}if(t.common.async)return Promise.all(n.map(async e=>{let n={...t,common:{...t.common,issues:[]},parent:null};return{result:await e._parseAsync({data:t.data,path:t.path,parent:n}),ctx:n}})).then(r);{let e,r=[];for(let i of n){let n={...t,common:{...t.common,issues:[]},parent:null},a=i._parseSync({data:t.data,path:t.path,parent:n});if(a.status===`valid`)return a;a.status===`dirty`&&!e&&(e={result:a,ctx:n}),n.common.issues.length&&r.push(n.common.issues)}if(e)return t.common.issues.push(...e.ctx.common.issues),e.result;let i=r.map(e=>new we(e));return R(t,{code:F.invalid_union,unionErrors:i}),z}}get options(){return this._def.options}};Ct.create=(e,t)=>new Ct({options:e,typeName:Zt.ZodUnion,...He(t)});var wt=e=>e instanceof Nt?wt(e.schema):e instanceof zt?wt(e.innerType()):e instanceof Pt?[e.value]:e instanceof It?e.options:e instanceof Lt?N.objectValues(e.enum):e instanceof Ht?wt(e._def.innerType):e instanceof mt?[void 0]:e instanceof ht?[null]:e instanceof Bt?[void 0,...wt(e.unwrap())]:e instanceof Vt?[null,...wt(e.unwrap())]:e instanceof Kt||e instanceof Jt?wt(e.unwrap()):e instanceof Ut?wt(e._def.innerType):[],Tt=class e extends V{_parse(e){let{ctx:t}=this._processInputParams(e);if(t.parsedType!==P.object)return R(t,{code:F.invalid_type,expected:P.object,received:t.parsedType}),z;let n=this.discriminator,r=t.data[n],i=this.optionsMap.get(r);return i?t.common.async?i._parseAsync({data:t.data,path:t.path,parent:t}):i._parseSync({data:t.data,path:t.path,parent:t}):(R(t,{code:F.invalid_union_discriminator,options:Array.from(this.optionsMap.keys()),path:[n]}),z)}get discriminator(){return this._def.discriminator}get options(){return this._def.options}get optionsMap(){return this._def.optionsMap}static create(t,n,r){let i=new Map;for(let e of n){let n=wt(e.shape[t]);if(!n.length)throw Error(`A discriminator value for key \`${t}\` could not be extracted from all schema options`);for(let r of n){if(i.has(r))throw Error(`Discriminator property ${String(t)} has duplicate value ${String(r)}`);i.set(r,e)}}return new e({typeName:Zt.ZodDiscriminatedUnion,discriminator:t,options:n,optionsMap:i,...He(r)})}};function Et(e,t){let n=Se(e),r=Se(t);if(e===t)return{valid:!0,data:e};if(n===P.object&&r===P.object){let n=N.objectKeys(t),r=N.objectKeys(e).filter(e=>n.indexOf(e)!==-1),i={...e,...t};for(let n of r){let r=Et(e[n],t[n]);if(!r.valid)return{valid:!1};i[n]=r.data}return{valid:!0,data:i}}else if(n===P.array&&r===P.array){if(e.length!==t.length)return{valid:!1};let n=[];for(let r=0;r<e.length;r++){let i=e[r],a=t[r],o=Et(i,a);if(!o.valid)return{valid:!1};n.push(o.data)}return{valid:!0,data:n}}else if(n===P.date&&r===P.date&&+e==+t)return{valid:!0,data:e};else return{valid:!1}}var Dt=class extends V{_parse(e){let{status:t,ctx:n}=this._processInputParams(e),r=(e,r)=>{if(Me(e)||Me(r))return z;let i=Et(e.value,r.value);return i.valid?((Ne(e)||Ne(r))&&t.dirty(),{status:t.value,value:i.data}):(R(n,{code:F.invalid_intersection_types}),z)};return n.common.async?Promise.all([this._def.left._parseAsync({data:n.data,path:n.path,parent:n}),this._def.right._parseAsync({data:n.data,path:n.path,parent:n})]).then(([e,t])=>r(e,t)):r(this._def.left._parseSync({data:n.data,path:n.path,parent:n}),this._def.right._parseSync({data:n.data,path:n.path,parent:n}))}};Dt.create=(e,t,n)=>new Dt({left:e,right:t,typeName:Zt.ZodIntersection,...He(n)});var Ot=class e extends V{_parse(e){let{status:t,ctx:n}=this._processInputParams(e);if(n.parsedType!==P.array)return R(n,{code:F.invalid_type,expected:P.array,received:n.parsedType}),z;if(n.data.length<this._def.items.length)return R(n,{code:F.too_small,minimum:this._def.items.length,inclusive:!0,exact:!1,type:`array`}),z;!this._def.rest&&n.data.length>this._def.items.length&&(R(n,{code:F.too_big,maximum:this._def.items.length,inclusive:!0,exact:!1,type:`array`}),t.dirty());let r=[...n.data].map((e,t)=>{let r=this._def.items[t]||this._def.rest;return r?r._parse(new Be(n,e,n.path,t)):null}).filter(e=>!!e);return n.common.async?Promise.all(r).then(e=>ke.mergeArray(t,e)):ke.mergeArray(t,r)}get items(){return this._def.items}rest(t){return new e({...this._def,rest:t})}};Ot.create=(e,t)=>{if(!Array.isArray(e))throw Error(`You must pass an array of schemas to z.tuple([ ... ])`);return new Ot({items:e,typeName:Zt.ZodTuple,rest:null,...He(t)})};var kt=class e extends V{get keySchema(){return this._def.keyType}get valueSchema(){return this._def.valueType}_parse(e){let{status:t,ctx:n}=this._processInputParams(e);if(n.parsedType!==P.object)return R(n,{code:F.invalid_type,expected:P.object,received:n.parsedType}),z;let r=[],i=this._def.keyType,a=this._def.valueType;for(let e in n.data)r.push({key:i._parse(new Be(n,e,n.path,e)),value:a._parse(new Be(n,n.data[e],n.path,e)),alwaysSet:e in n.data});return n.common.async?ke.mergeObjectAsync(t,r):ke.mergeObjectSync(t,r)}get element(){return this._def.valueType}static create(t,n,r){return n instanceof V?new e({keyType:t,valueType:n,typeName:Zt.ZodRecord,...He(r)}):new e({keyType:st.create(),valueType:t,typeName:Zt.ZodRecord,...He(n)})}},At=class extends V{get keySchema(){return this._def.keyType}get valueSchema(){return this._def.valueType}_parse(e){let{status:t,ctx:n}=this._processInputParams(e);if(n.parsedType!==P.map)return R(n,{code:F.invalid_type,expected:P.map,received:n.parsedType}),z;let r=this._def.keyType,i=this._def.valueType,a=[...n.data.entries()].map(([e,t],a)=>({key:r._parse(new Be(n,e,n.path,[a,`key`])),value:i._parse(new Be(n,t,n.path,[a,`value`]))}));if(n.common.async){let e=new Map;return Promise.resolve().then(async()=>{for(let n of a){let r=await n.key,i=await n.value;if(r.status===`aborted`||i.status===`aborted`)return z;(r.status===`dirty`||i.status===`dirty`)&&t.dirty(),e.set(r.value,i.value)}return{status:t.value,value:e}})}else{let e=new Map;for(let n of a){let r=n.key,i=n.value;if(r.status===`aborted`||i.status===`aborted`)return z;(r.status===`dirty`||i.status===`dirty`)&&t.dirty(),e.set(r.value,i.value)}return{status:t.value,value:e}}}};At.create=(e,t,n)=>new At({valueType:t,keyType:e,typeName:Zt.ZodMap,...He(n)});var jt=class e extends V{_parse(e){let{status:t,ctx:n}=this._processInputParams(e);if(n.parsedType!==P.set)return R(n,{code:F.invalid_type,expected:P.set,received:n.parsedType}),z;let r=this._def;r.minSize!==null&&n.data.size<r.minSize.value&&(R(n,{code:F.too_small,minimum:r.minSize.value,type:`set`,inclusive:!0,exact:!1,message:r.minSize.message}),t.dirty()),r.maxSize!==null&&n.data.size>r.maxSize.value&&(R(n,{code:F.too_big,maximum:r.maxSize.value,type:`set`,inclusive:!0,exact:!1,message:r.maxSize.message}),t.dirty());let i=this._def.valueType;function a(e){let n=new Set;for(let r of e){if(r.status===`aborted`)return z;r.status===`dirty`&&t.dirty(),n.add(r.value)}return{status:t.value,value:n}}let o=[...n.data.values()].map((e,t)=>i._parse(new Be(n,e,n.path,t)));return n.common.async?Promise.all(o).then(e=>a(e)):a(o)}min(t,n){return new e({...this._def,minSize:{value:t,message:B.toString(n)}})}max(t,n){return new e({...this._def,maxSize:{value:t,message:B.toString(n)}})}size(e,t){return this.min(e,t).max(e,t)}nonempty(e){return this.min(1,e)}};jt.create=(e,t)=>new jt({valueType:e,minSize:null,maxSize:null,typeName:Zt.ZodSet,...He(t)});var Mt=class e extends V{constructor(){super(...arguments),this.validate=this.implement}_parse(e){let{ctx:t}=this._processInputParams(e);if(t.parsedType!==P.function)return R(t,{code:F.invalid_type,expected:P.function,received:t.parsedType}),z;function n(e,n){return De({data:e,path:t.path,errorMaps:[t.common.contextualErrorMap,t.schemaErrorMap,L(),Te].filter(e=>!!e),issueData:{code:F.invalid_arguments,argumentsError:n}})}function r(e,n){return De({data:e,path:t.path,errorMaps:[t.common.contextualErrorMap,t.schemaErrorMap,L(),Te].filter(e=>!!e),issueData:{code:F.invalid_return_type,returnTypeError:n}})}let i={errorMap:t.common.contextualErrorMap},a=t.data;if(this._def.returns instanceof Rt){let e=this;return je(async function(...t){let o=new we([]),s=await e._def.args.parseAsync(t,i).catch(e=>{throw o.addIssue(n(t,e)),o}),c=await Reflect.apply(a,this,s);return await e._def.returns._def.type.parseAsync(c,i).catch(e=>{throw o.addIssue(r(c,e)),o})})}else{let e=this;return je(function(...t){let o=e._def.args.safeParse(t,i);if(!o.success)throw new we([n(t,o.error)]);let s=Reflect.apply(a,this,o.data),c=e._def.returns.safeParse(s,i);if(!c.success)throw new we([r(s,c.error)]);return c.data})}}parameters(){return this._def.args}returnType(){return this._def.returns}args(...t){return new e({...this._def,args:Ot.create(t).rest(_t.create())})}returns(t){return new e({...this._def,returns:t})}implement(e){return this.parse(e)}strictImplement(e){return this.parse(e)}static create(t,n,r){return new e({args:t||Ot.create([]).rest(_t.create()),returns:n||_t.create(),typeName:Zt.ZodFunction,...He(r)})}},Nt=class extends V{get schema(){return this._def.getter()}_parse(e){let{ctx:t}=this._processInputParams(e);return this._def.getter()._parse({data:t.data,path:t.path,parent:t})}};Nt.create=(e,t)=>new Nt({getter:e,typeName:Zt.ZodLazy,...He(t)});var Pt=class extends V{_parse(e){if(e.data!==this._def.value){let t=this._getOrReturnCtx(e);return R(t,{received:t.data,code:F.invalid_literal,expected:this._def.value}),z}return{status:`valid`,value:e.data}}get value(){return this._def.value}};Pt.create=(e,t)=>new Pt({value:e,typeName:Zt.ZodLiteral,...He(t)});function Ft(e,t){return new It({values:e,typeName:Zt.ZodEnum,...He(t)})}var It=class e extends V{constructor(){super(...arguments),Re.set(this,void 0)}_parse(e){if(typeof e.data!=`string`){let t=this._getOrReturnCtx(e),n=this._def.values;return R(t,{expected:N.joinValues(n),received:t.parsedType,code:F.invalid_type}),z}if(Ie(this,Re)||Le(this,Re,new Set(this._def.values)),!Ie(this,Re).has(e.data)){let t=this._getOrReturnCtx(e),n=this._def.values;return R(t,{received:t.data,code:F.invalid_enum_value,options:n}),z}return je(e.data)}get options(){return this._def.values}get enum(){let e={};for(let t of this._def.values)e[t]=t;return e}get Values(){let e={};for(let t of this._def.values)e[t]=t;return e}get Enum(){let e={};for(let t of this._def.values)e[t]=t;return e}extract(t,n=this._def){return e.create(t,{...this._def,...n})}exclude(t,n=this._def){return e.create(this.options.filter(e=>!t.includes(e)),{...this._def,...n})}};Re=new WeakMap,It.create=Ft;var Lt=class extends V{constructor(){super(...arguments),ze.set(this,void 0)}_parse(e){let t=N.getValidEnumValues(this._def.values),n=this._getOrReturnCtx(e);if(n.parsedType!==P.string&&n.parsedType!==P.number){let e=N.objectValues(t);return R(n,{expected:N.joinValues(e),received:n.parsedType,code:F.invalid_type}),z}if(Ie(this,ze)||Le(this,ze,new Set(N.getValidEnumValues(this._def.values))),!Ie(this,ze).has(e.data)){let e=N.objectValues(t);return R(n,{received:n.data,code:F.invalid_enum_value,options:e}),z}return je(e.data)}get enum(){return this._def.values}};ze=new WeakMap,Lt.create=(e,t)=>new Lt({values:e,typeName:Zt.ZodNativeEnum,...He(t)});var Rt=class extends V{unwrap(){return this._def.type}_parse(e){let{ctx:t}=this._processInputParams(e);return t.parsedType!==P.promise&&t.common.async===!1?(R(t,{code:F.invalid_type,expected:P.promise,received:t.parsedType}),z):je((t.parsedType===P.promise?t.data:Promise.resolve(t.data)).then(e=>this._def.type.parseAsync(e,{path:t.path,errorMap:t.common.contextualErrorMap})))}};Rt.create=(e,t)=>new Rt({type:e,typeName:Zt.ZodPromise,...He(t)});var zt=class extends V{innerType(){return this._def.schema}sourceType(){return this._def.schema._def.typeName===Zt.ZodEffects?this._def.schema.sourceType():this._def.schema}_parse(e){let{status:t,ctx:n}=this._processInputParams(e),r=this._def.effect||null,i={addIssue:e=>{R(n,e),e.fatal?t.abort():t.dirty()},get path(){return n.path}};if(i.addIssue=i.addIssue.bind(i),r.type===`preprocess`){let e=r.transform(n.data,i);if(n.common.async)return Promise.resolve(e).then(async e=>{if(t.value===`aborted`)return z;let r=await this._def.schema._parseAsync({data:e,path:n.path,parent:n});return r.status===`aborted`?z:r.status===`dirty`||t.value===`dirty`?Ae(r.value):r});{if(t.value===`aborted`)return z;let r=this._def.schema._parseSync({data:e,path:n.path,parent:n});return r.status===`aborted`?z:r.status===`dirty`||t.value===`dirty`?Ae(r.value):r}}if(r.type===`refinement`){let e=e=>{let t=r.refinement(e,i);if(n.common.async)return Promise.resolve(t);if(t instanceof Promise)throw Error(`Async refinement encountered during synchronous parse operation. Use .parseAsync instead.`);return e};if(n.common.async===!1){let r=this._def.schema._parseSync({data:n.data,path:n.path,parent:n});return r.status===`aborted`?z:(r.status===`dirty`&&t.dirty(),e(r.value),{status:t.value,value:r.value})}else return this._def.schema._parseAsync({data:n.data,path:n.path,parent:n}).then(n=>n.status===`aborted`?z:(n.status===`dirty`&&t.dirty(),e(n.value).then(()=>({status:t.value,value:n.value}))))}if(r.type===`transform`)if(n.common.async===!1){let e=this._def.schema._parseSync({data:n.data,path:n.path,parent:n});if(!Pe(e))return e;let a=r.transform(e.value,i);if(a instanceof Promise)throw Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);return{status:t.value,value:a}}else return this._def.schema._parseAsync({data:n.data,path:n.path,parent:n}).then(e=>Pe(e)?Promise.resolve(r.transform(e.value,i)).then(e=>({status:t.value,value:e})):e);N.assertNever(r)}};zt.create=(e,t,n)=>new zt({schema:e,typeName:Zt.ZodEffects,effect:t,...He(n)}),zt.createWithPreprocess=(e,t,n)=>new zt({schema:t,effect:{type:`preprocess`,transform:e},typeName:Zt.ZodEffects,...He(n)});var Bt=class extends V{_parse(e){return this._getType(e)===P.undefined?je(void 0):this._def.innerType._parse(e)}unwrap(){return this._def.innerType}};Bt.create=(e,t)=>new Bt({innerType:e,typeName:Zt.ZodOptional,...He(t)});var Vt=class extends V{_parse(e){return this._getType(e)===P.null?je(null):this._def.innerType._parse(e)}unwrap(){return this._def.innerType}};Vt.create=(e,t)=>new Vt({innerType:e,typeName:Zt.ZodNullable,...He(t)});var Ht=class extends V{_parse(e){let{ctx:t}=this._processInputParams(e),n=t.data;return t.parsedType===P.undefined&&(n=this._def.defaultValue()),this._def.innerType._parse({data:n,path:t.path,parent:t})}removeDefault(){return this._def.innerType}};Ht.create=(e,t)=>new Ht({innerType:e,typeName:Zt.ZodDefault,defaultValue:typeof t.default==`function`?t.default:()=>t.default,...He(t)});var Ut=class extends V{_parse(e){let{ctx:t}=this._processInputParams(e),n={...t,common:{...t.common,issues:[]}},r=this._def.innerType._parse({data:n.data,path:n.path,parent:{...n}});return Fe(r)?r.then(e=>({status:`valid`,value:e.status===`valid`?e.value:this._def.catchValue({get error(){return new we(n.common.issues)},input:n.data})})):{status:`valid`,value:r.status===`valid`?r.value:this._def.catchValue({get error(){return new we(n.common.issues)},input:n.data})}}removeCatch(){return this._def.innerType}};Ut.create=(e,t)=>new Ut({innerType:e,typeName:Zt.ZodCatch,catchValue:typeof t.catch==`function`?t.catch:()=>t.catch,...He(t)});var Wt=class extends V{_parse(e){if(this._getType(e)!==P.nan){let t=this._getOrReturnCtx(e);return R(t,{code:F.invalid_type,expected:P.nan,received:t.parsedType}),z}return{status:`valid`,value:e.data}}};Wt.create=e=>new Wt({typeName:Zt.ZodNaN,...He(e)});var Gt=Symbol(`zod_brand`),Kt=class extends V{_parse(e){let{ctx:t}=this._processInputParams(e),n=t.data;return this._def.type._parse({data:n,path:t.path,parent:t})}unwrap(){return this._def.type}},qt=class e extends V{_parse(e){let{status:t,ctx:n}=this._processInputParams(e);if(n.common.async)return(async()=>{let e=await this._def.in._parseAsync({data:n.data,path:n.path,parent:n});return e.status===`aborted`?z:e.status===`dirty`?(t.dirty(),Ae(e.value)):this._def.out._parseAsync({data:e.value,path:n.path,parent:n})})();{let e=this._def.in._parseSync({data:n.data,path:n.path,parent:n});return e.status===`aborted`?z:e.status===`dirty`?(t.dirty(),{status:`dirty`,value:e.value}):this._def.out._parseSync({data:e.value,path:n.path,parent:n})}}static create(t,n){return new e({in:t,out:n,typeName:Zt.ZodPipeline})}},Jt=class extends V{_parse(e){let t=this._def.innerType._parse(e),n=e=>(Pe(e)&&(e.value=Object.freeze(e.value)),e);return Fe(t)?t.then(e=>n(e)):n(t)}unwrap(){return this._def.innerType}};Jt.create=(e,t)=>new Jt({innerType:e,typeName:Zt.ZodReadonly,...He(t)});function Yt(e,t={},n){return e?gt.create().superRefine((r,i)=>{if(!e(r)){let e=typeof t==`function`?t(r):typeof t==`string`?{message:t}:t,a=e.fatal??n??!0,o=typeof e==`string`?{message:e}:e;i.addIssue({code:`custom`,...o,fatal:a})}}):gt.create()}var Xt={object:St.lazycreate},Zt;(function(e){e.ZodString=`ZodString`,e.ZodNumber=`ZodNumber`,e.ZodNaN=`ZodNaN`,e.ZodBigInt=`ZodBigInt`,e.ZodBoolean=`ZodBoolean`,e.ZodDate=`ZodDate`,e.ZodSymbol=`ZodSymbol`,e.ZodUndefined=`ZodUndefined`,e.ZodNull=`ZodNull`,e.ZodAny=`ZodAny`,e.ZodUnknown=`ZodUnknown`,e.ZodNever=`ZodNever`,e.ZodVoid=`ZodVoid`,e.ZodArray=`ZodArray`,e.ZodObject=`ZodObject`,e.ZodUnion=`ZodUnion`,e.ZodDiscriminatedUnion=`ZodDiscriminatedUnion`,e.ZodIntersection=`ZodIntersection`,e.ZodTuple=`ZodTuple`,e.ZodRecord=`ZodRecord`,e.ZodMap=`ZodMap`,e.ZodSet=`ZodSet`,e.ZodFunction=`ZodFunction`,e.ZodLazy=`ZodLazy`,e.ZodLiteral=`ZodLiteral`,e.ZodEnum=`ZodEnum`,e.ZodEffects=`ZodEffects`,e.ZodNativeEnum=`ZodNativeEnum`,e.ZodOptional=`ZodOptional`,e.ZodNullable=`ZodNullable`,e.ZodDefault=`ZodDefault`,e.ZodCatch=`ZodCatch`,e.ZodPromise=`ZodPromise`,e.ZodBranded=`ZodBranded`,e.ZodPipeline=`ZodPipeline`,e.ZodReadonly=`ZodReadonly`})(Zt||={});var Qt=(e,t={message:`Input not instance of ${e.name}`})=>Yt(t=>t instanceof e,t),H=st.create,U=lt.create,$t=Wt.create,en=ut.create,W=dt.create,tn=ft.create,nn=pt.create,rn=mt.create,an=ht.create,on=gt.create,sn=_t.create,cn=vt.create,ln=yt.create,un=bt.create,G=St.create,dn=St.strictCreate,fn=Ct.create,pn=Tt.create,mn=Dt.create,hn=Ot.create,gn=kt.create,_n=At.create,vn=jt.create,yn=Mt.create,bn=Nt.create,xn=Pt.create,Sn=It.create,Cn=Lt.create,wn=Rt.create,Tn=zt.create,En=Bt.create,Dn=Vt.create,On=zt.createWithPreprocess,kn=qt.create,K=Object.freeze({__proto__:null,defaultErrorMap:Te,setErrorMap:Ee,getErrorMap:L,makeIssue:De,EMPTY_PATH:Oe,addIssueToContext:R,ParseStatus:ke,INVALID:z,DIRTY:Ae,OK:je,isAborted:Me,isDirty:Ne,isValid:Pe,isAsync:Fe,get util(){return N},get objectUtil(){return xe},ZodParsedType:P,getParsedType:Se,ZodType:V,datetimeRegex:at,ZodString:st,ZodNumber:lt,ZodBigInt:ut,ZodBoolean:dt,ZodDate:ft,ZodSymbol:pt,ZodUndefined:mt,ZodNull:ht,ZodAny:gt,ZodUnknown:_t,ZodNever:vt,ZodVoid:yt,ZodArray:bt,ZodObject:St,ZodUnion:Ct,ZodDiscriminatedUnion:Tt,ZodIntersection:Dt,ZodTuple:Ot,ZodRecord:kt,ZodMap:At,ZodSet:jt,ZodFunction:Mt,ZodLazy:Nt,ZodLiteral:Pt,ZodEnum:It,ZodNativeEnum:Lt,ZodPromise:Rt,ZodEffects:zt,ZodTransformer:zt,ZodOptional:Bt,ZodNullable:Vt,ZodDefault:Ht,ZodCatch:Ut,ZodNaN:Wt,BRAND:Gt,ZodBranded:Kt,ZodPipeline:qt,ZodReadonly:Jt,custom:Yt,Schema:V,ZodSchema:V,late:Xt,get ZodFirstPartyTypeKind(){return Zt},coerce:{string:(e=>st.create({...e,coerce:!0})),number:(e=>lt.create({...e,coerce:!0})),boolean:(e=>dt.create({...e,coerce:!0})),bigint:(e=>ut.create({...e,coerce:!0})),date:(e=>ft.create({...e,coerce:!0}))},any:on,array:un,bigint:en,boolean:W,date:tn,discriminatedUnion:pn,effect:Tn,enum:Sn,function:yn,instanceof:Qt,intersection:mn,lazy:bn,literal:xn,map:_n,nan:$t,nativeEnum:Cn,never:cn,null:an,nullable:Dn,number:U,object:G,oboolean:()=>W().optional(),onumber:()=>U().optional(),optional:En,ostring:()=>H().optional(),pipeline:kn,preprocess:On,promise:wn,record:gn,set:vn,strictObject:dn,string:H,symbol:nn,transformer:Tn,tuple:hn,undefined:rn,union:fn,unknown:sn,void:ln,NEVER:z,ZodIssueCode:F,quotelessJson:Ce,ZodError:we}),An={exports:{}},jn;function Mn(){return jn?An.exports:(jn=1,(function(e){var t=(function(e){var n=1e7,r=9007199254740992,i=f(r),a=`0123456789abcdefghijklmnopqrstuvwxyz`,o=typeof BigInt==`function`;function s(e,t,n,r){return e===void 0?s[0]:t===void 0||+t==10&&!n?F(e):ve(e,t,n,r)}function c(e,t){this.value=e,this.sign=t,this.isSmall=!1}c.prototype=Object.create(s.prototype);function l(e){this.value=e,this.sign=e<0,this.isSmall=!0}l.prototype=Object.create(s.prototype);function u(e){this.value=e}u.prototype=Object.create(s.prototype);function d(e){return-r<e&&e<r}function f(e){return e<1e7?[e]:e<0x5af3107a4000?[e%1e7,Math.floor(e/1e7)]:[e%1e7,Math.floor(e/1e7)%1e7,Math.floor(e/0x5af3107a4000)]}function p(e){m(e);var t=e.length;if(t<4&&re(e,i)<0)switch(t){case 0:return 0;case 1:return e[0];case 2:return e[0]+e[1]*n;default:return e[0]+(e[1]+e[2]*n)*n}return e}function m(e){for(var t=e.length;e[--t]===0;);e.length=t+1}function h(e){for(var t=Array(e),n=-1;++n<e;)t[n]=0;return t}function g(e){return e>0?Math.floor(e):Math.ceil(e)}function _(e,t){var r=e.length,i=t.length,a=Array(r),o=0,s=n,c,l;for(l=0;l<i;l++)c=e[l]+t[l]+o,o=+(c>=s),a[l]=c-o*s;for(;l<r;)c=e[l]+o,o=+(c===s),a[l++]=c-o*s;return o>0&&a.push(o),a}function v(e,t){return e.length>=t.length?_(e,t):_(t,e)}function y(e,t){var r=e.length,i=Array(r),a=n,o,s;for(s=0;s<r;s++)o=e[s]-a+t,t=Math.floor(o/a),i[s]=o-t*a,t+=1;for(;t>0;)i[s++]=t%a,t=Math.floor(t/a);return i}c.prototype.add=function(e){var t=F(e);if(this.sign!==t.sign)return this.subtract(t.negate());var n=this.value,r=t.value;return t.isSmall?new c(y(n,Math.abs(r)),this.sign):new c(v(n,r),this.sign)},c.prototype.plus=c.prototype.add,l.prototype.add=function(e){var t=F(e),n=this.value;if(n<0!==t.sign)return this.subtract(t.negate());var r=t.value;if(t.isSmall){if(d(n+r))return new l(n+r);r=f(Math.abs(r))}return new c(y(r,Math.abs(n)),n<0)},l.prototype.plus=l.prototype.add,u.prototype.add=function(e){return new u(this.value+F(e).value)},u.prototype.plus=u.prototype.add;function b(e,t){var r=e.length,i=t.length,a=Array(r),o=0,s=n,c,l;for(c=0;c<i;c++)l=e[c]-o-t[c],l<0?(l+=s,o=1):o=0,a[c]=l;for(c=i;c<r;c++){if(l=e[c]-o,l<0)l+=s;else{a[c++]=l;break}a[c]=l}for(;c<r;c++)a[c]=e[c];return m(a),a}function x(e,t,n){var r;return re(e,t)>=0?r=b(e,t):(r=b(t,e),n=!n),r=p(r),typeof r==`number`?(n&&(r=-r),new l(r)):new c(r,n)}function S(e,t,r){var i=e.length,a=Array(i),o=-t,s=n,u,d;for(u=0;u<i;u++)d=e[u]+o,o=Math.floor(d/s),d%=s,a[u]=d<0?d+s:d;return a=p(a),typeof a==`number`?(r&&(a=-a),new l(a)):new c(a,r)}c.prototype.subtract=function(e){var t=F(e);if(this.sign!==t.sign)return this.add(t.negate());var n=this.value,r=t.value;return t.isSmall?S(n,Math.abs(r),this.sign):x(n,r,this.sign)},c.prototype.minus=c.prototype.subtract,l.prototype.subtract=function(e){var t=F(e),n=this.value;if(n<0!==t.sign)return this.add(t.negate());var r=t.value;return t.isSmall?new l(n-r):S(r,Math.abs(n),n>=0)},l.prototype.minus=l.prototype.subtract,u.prototype.subtract=function(e){return new u(this.value-F(e).value)},u.prototype.minus=u.prototype.subtract,c.prototype.negate=function(){return new c(this.value,!this.sign)},l.prototype.negate=function(){var e=this.sign,t=new l(-this.value);return t.sign=!e,t},u.prototype.negate=function(){return new u(-this.value)},c.prototype.abs=function(){return new c(this.value,!1)},l.prototype.abs=function(){return new l(Math.abs(this.value))},u.prototype.abs=function(){return new u(this.value>=0?this.value:-this.value)};function C(e,t){var r=e.length,i=t.length,a=h(r+i),o=n,s,c,l,u,d;for(l=0;l<r;++l){u=e[l];for(var f=0;f<i;++f)d=t[f],s=u*d+a[l+f],c=Math.floor(s/o),a[l+f]=s-c*o,a[l+f+1]+=c}return m(a),a}function w(e,t){var r=e.length,i=Array(r),a=n,o=0,s,c;for(c=0;c<r;c++)s=e[c]*t+o,o=Math.floor(s/a),i[c]=s-o*a;for(;o>0;)i[c++]=o%a,o=Math.floor(o/a);return i}function T(e,t){for(var n=[];t-->0;)n.push(0);return n.concat(e)}function E(e,t){var n=Math.max(e.length,t.length);if(n<=30)return C(e,t);n=Math.ceil(n/2);var r=e.slice(n),i=e.slice(0,n),a=t.slice(n),o=t.slice(0,n),s=E(i,o),c=E(r,a),l=v(v(s,T(b(b(E(v(i,r),v(o,a)),s),c),n)),T(c,2*n));return m(l),l}function D(e,t){return-.012*e-.012*t+15e-6*e*t>0}c.prototype.multiply=function(e){var t=F(e),r=this.value,i=t.value,a=this.sign!==t.sign,o;if(t.isSmall){if(i===0)return s[0];if(i===1)return this;if(i===-1)return this.negate();if(o=Math.abs(i),o<n)return new c(w(r,o),a);i=f(o)}return D(r.length,i.length)?new c(E(r,i),a):new c(C(r,i),a)},c.prototype.times=c.prototype.multiply;function O(e,t,r){return e<n?new c(w(t,e),r):new c(C(t,f(e)),r)}l.prototype._multiplyBySmall=function(e){return d(e.value*this.value)?new l(e.value*this.value):O(Math.abs(e.value),f(Math.abs(this.value)),this.sign!==e.sign)},c.prototype._multiplyBySmall=function(e){return e.value===0?s[0]:e.value===1?this:e.value===-1?this.negate():O(Math.abs(e.value),this.value,this.sign!==e.sign)},l.prototype.multiply=function(e){return F(e)._multiplyBySmall(this)},l.prototype.times=l.prototype.multiply,u.prototype.multiply=function(e){return new u(this.value*F(e).value)},u.prototype.times=u.prototype.multiply;function ee(e){var t=e.length,r=h(t+t),i=n,a,o,s,c,l;for(s=0;s<t;s++){c=e[s],o=0-c*c;for(var u=s;u<t;u++)l=e[u],a=c*l*2+r[s+u]+o,o=Math.floor(a/i),r[s+u]=a-o*i;r[s+t]=o}return m(r),r}c.prototype.square=function(){return new c(ee(this.value),!1)},l.prototype.square=function(){var e=this.value*this.value;return d(e)?new l(e):new c(ee(f(Math.abs(this.value))),!1)},u.prototype.square=function(e){return new u(this.value*this.value)};function k(e,t){var r=e.length,i=t.length,a=n,o=h(t.length),s=t[i-1],c=Math.ceil(a/(2*s)),l=w(e,c),u=w(t,c),d,f,m,g,_,v,y;for(l.length<=r&&l.push(0),u.push(0),s=u[i-1],f=r-i;f>=0;f--){for(d=a-1,l[f+i]!==s&&(d=Math.floor((l[f+i]*a+l[f+i-1])/s)),m=0,g=0,v=u.length,_=0;_<v;_++)m+=d*u[_],y=Math.floor(m/a),g+=l[f+_]-(m-y*a),m=y,g<0?(l[f+_]=g+a,g=-1):(l[f+_]=g,g=0);for(;g!==0;){for(--d,m=0,_=0;_<v;_++)m+=l[f+_]-a+u[_],m<0?(l[f+_]=m+a,m=0):(l[f+_]=m,m=1);g+=m}o[f]=d}return l=ne(l,c)[0],[p(o),p(l)]}function te(e,t){for(var r=e.length,i=t.length,a=[],o=[],s=n,c,l,u,d,f;r;){if(o.unshift(e[--r]),m(o),re(o,t)<0){a.push(0);continue}l=o.length,u=o[l-1]*s+o[l-2],d=t[i-1]*s+t[i-2],l>i&&(u=(u+1)*s),c=Math.ceil(u/d);do{if(f=w(t,c),re(f,o)<=0)break;c--}while(c);a.push(c),o=b(o,f)}return a.reverse(),[p(a),p(o)]}function ne(e,t){var r=e.length,i=h(r),a=n,o,s,c=0,l;for(o=r-1;o>=0;--o)l=c*a+e[o],s=g(l/t),c=l-s*t,i[o]=s|0;return[i,c|0]}function A(e,t){var r,i=F(t);if(o)return[new u(e.value/i.value),new u(e.value%i.value)];var a=e.value,d=i.value,m;if(d===0)throw Error(`Cannot divide by zero`);if(e.isSmall)return i.isSmall?[new l(g(a/d)),new l(a%d)]:[s[0],e];if(i.isSmall){if(d===1)return[e,s[0]];if(d==-1)return[e.negate(),s[0]];var h=Math.abs(d);if(h<n){r=ne(a,h),m=p(r[0]);var _=r[1];return e.sign&&(_=-_),typeof m==`number`?(e.sign!==i.sign&&(m=-m),[new l(m),new l(_)]):[new c(m,e.sign!==i.sign),new l(_)]}d=f(h)}var v=re(a,d);if(v===-1)return[s[0],e];if(v===0)return[s[e.sign===i.sign?1:-1],s[0]];r=a.length+d.length<=200?k(a,d):te(a,d),m=r[0];var y=e.sign!==i.sign,b=r[1],x=e.sign;return typeof m==`number`?(y&&(m=-m),m=new l(m)):m=new c(m,y),typeof b==`number`?(x&&(b=-b),b=new l(b)):b=new c(b,x),[m,b]}c.prototype.divmod=function(e){var t=A(this,e);return{quotient:t[0],remainder:t[1]}},u.prototype.divmod=l.prototype.divmod=c.prototype.divmod,c.prototype.divide=function(e){return A(this,e)[0]},u.prototype.over=u.prototype.divide=function(e){return new u(this.value/F(e).value)},l.prototype.over=l.prototype.divide=c.prototype.over=c.prototype.divide,c.prototype.mod=function(e){return A(this,e)[1]},u.prototype.mod=u.prototype.remainder=function(e){return new u(this.value%F(e).value)},l.prototype.remainder=l.prototype.mod=c.prototype.remainder=c.prototype.mod,c.prototype.pow=function(e){var t=F(e),n=this.value,r=t.value,i,a,o;if(r===0)return s[1];if(n===0)return s[0];if(n===1)return s[1];if(n===-1)return t.isEven()?s[1]:s[-1];if(t.sign)return s[0];if(!t.isSmall)throw Error(`The exponent `+t.toString()+` is too large.`);if(this.isSmall&&d(i=n**+r))return new l(g(i));for(a=this,o=s[1];r&!0&&(o=o.times(a),--r),r!==0;)r/=2,a=a.square();return o},l.prototype.pow=c.prototype.pow,u.prototype.pow=function(e){var t=F(e),n=this.value,r=t.value,i=BigInt(0),a=BigInt(1),o=BigInt(2);if(r===i)return s[1];if(n===i)return s[0];if(n===a)return s[1];if(n===BigInt(-1))return t.isEven()?s[1]:s[-1];if(t.isNegative())return new u(i);for(var c=this,l=s[1];(r&a)===a&&(l=l.times(c),--r),r!==i;)r/=o,c=c.square();return l},c.prototype.modPow=function(e,t){if(e=F(e),t=F(t),t.isZero())throw Error(`Cannot take modPow with modulus 0`);var n=s[1],r=this.mod(t);for(e.isNegative()&&(e=e.multiply(s[-1]),r=r.modInv(t));e.isPositive();){if(r.isZero())return s[0];e.isOdd()&&(n=n.multiply(r).mod(t)),e=e.divide(2),r=r.square().mod(t)}return n},u.prototype.modPow=l.prototype.modPow=c.prototype.modPow;function re(e,t){if(e.length!==t.length)return e.length>t.length?1:-1;for(var n=e.length-1;n>=0;n--)if(e[n]!==t[n])return e[n]>t[n]?1:-1;return 0}c.prototype.compareAbs=function(e){var t=F(e),n=this.value,r=t.value;return t.isSmall?1:re(n,r)},l.prototype.compareAbs=function(e){var t=F(e),n=Math.abs(this.value),r=t.value;return t.isSmall?(r=Math.abs(r),n===r?0:n>r?1:-1):-1},u.prototype.compareAbs=function(e){var t=this.value,n=F(e).value;return t=t>=0?t:-t,n=n>=0?n:-n,t===n?0:t>n?1:-1},c.prototype.compare=function(e){if(e===1/0)return-1;if(e===-1/0)return 1;var t=F(e),n=this.value,r=t.value;return this.sign===t.sign?t.isSmall?this.sign?-1:1:re(n,r)*(this.sign?-1:1):t.sign?1:-1},c.prototype.compareTo=c.prototype.compare,l.prototype.compare=function(e){if(e===1/0)return-1;if(e===-1/0)return 1;var t=F(e),n=this.value,r=t.value;return t.isSmall?n==r?0:n>r?1:-1:n<0===t.sign?n<0?1:-1:n<0?-1:1},l.prototype.compareTo=l.prototype.compare,u.prototype.compare=function(e){if(e===1/0)return-1;if(e===-1/0)return 1;var t=this.value,n=F(e).value;return t===n?0:t>n?1:-1},u.prototype.compareTo=u.prototype.compare,c.prototype.equals=function(e){return this.compare(e)===0},u.prototype.eq=u.prototype.equals=l.prototype.eq=l.prototype.equals=c.prototype.eq=c.prototype.equals,c.prototype.notEquals=function(e){return this.compare(e)!==0},u.prototype.neq=u.prototype.notEquals=l.prototype.neq=l.prototype.notEquals=c.prototype.neq=c.prototype.notEquals,c.prototype.greater=function(e){return this.compare(e)>0},u.prototype.gt=u.prototype.greater=l.prototype.gt=l.prototype.greater=c.prototype.gt=c.prototype.greater,c.prototype.lesser=function(e){return this.compare(e)<0},u.prototype.lt=u.prototype.lesser=l.prototype.lt=l.prototype.lesser=c.prototype.lt=c.prototype.lesser,c.prototype.greaterOrEquals=function(e){return this.compare(e)>=0},u.prototype.geq=u.prototype.greaterOrEquals=l.prototype.geq=l.prototype.greaterOrEquals=c.prototype.geq=c.prototype.greaterOrEquals,c.prototype.lesserOrEquals=function(e){return this.compare(e)<=0},u.prototype.leq=u.prototype.lesserOrEquals=l.prototype.leq=l.prototype.lesserOrEquals=c.prototype.leq=c.prototype.lesserOrEquals,c.prototype.isEven=function(){return(this.value[0]&1)==0},l.prototype.isEven=function(){return(this.value&1)==0},u.prototype.isEven=function(){return(this.value&BigInt(1))===BigInt(0)},c.prototype.isOdd=function(){return(this.value[0]&1)==1},l.prototype.isOdd=function(){return(this.value&1)==1},u.prototype.isOdd=function(){return(this.value&BigInt(1))===BigInt(1)},c.prototype.isPositive=function(){return!this.sign},l.prototype.isPositive=function(){return this.value>0},u.prototype.isPositive=l.prototype.isPositive,c.prototype.isNegative=function(){return this.sign},l.prototype.isNegative=function(){return this.value<0},u.prototype.isNegative=l.prototype.isNegative,c.prototype.isUnit=function(){return!1},l.prototype.isUnit=function(){return Math.abs(this.value)===1},u.prototype.isUnit=function(){return this.abs().value===BigInt(1)},c.prototype.isZero=function(){return!1},l.prototype.isZero=function(){return this.value===0},u.prototype.isZero=function(){return this.value===BigInt(0)},c.prototype.isDivisibleBy=function(e){var t=F(e);return t.isZero()?!1:t.isUnit()?!0:t.compareAbs(2)===0?this.isEven():this.mod(t).isZero()},u.prototype.isDivisibleBy=l.prototype.isDivisibleBy=c.prototype.isDivisibleBy;function ie(e){var t=e.abs();if(t.isUnit())return!1;if(t.equals(2)||t.equals(3)||t.equals(5))return!0;if(t.isEven()||t.isDivisibleBy(3)||t.isDivisibleBy(5))return!1;if(t.lesser(49))return!0}function ae(e,n){for(var r=e.prev(),i=r,a=0,o,s,c;i.isEven();)i=i.divide(2),a++;next:for(s=0;s<n.length;s++)if(!e.lesser(n[s])&&(c=t(n[s]).modPow(i,e),!(c.isUnit()||c.equals(r)))){for(o=a-1;o!=0;o--){if(c=c.square().mod(e),c.isUnit())return!1;if(c.equals(r))continue next}return!1}return!0}c.prototype.isPrime=function(n){var r=ie(this);if(r!==e)return r;var i=this.abs(),a=i.bitLength();if(a<=64)return ae(i,[2,3,5,7,11,13,17,19,23,29,31,37]);for(var o=Math.log(2)*a.toJSNumber(),s=Math.ceil(n===!0?2*o**2:o),c=[],l=0;l<s;l++)c.push(t(l+2));return ae(i,c)},u.prototype.isPrime=l.prototype.isPrime=c.prototype.isPrime,c.prototype.isProbablePrime=function(n,r){var i=ie(this);if(i!==e)return i;for(var a=this.abs(),o=n===e?5:n,s=[],c=0;c<o;c++)s.push(t.randBetween(2,a.minus(2),r));return ae(a,s)},u.prototype.isProbablePrime=l.prototype.isProbablePrime=c.prototype.isProbablePrime,c.prototype.modInv=function(e){for(var n=t.zero,r=t.one,i=F(e),a=this.abs(),o,s,c;!a.isZero();)o=i.divide(a),s=n,c=i,n=r,i=a,r=s.subtract(o.multiply(r)),a=c.subtract(o.multiply(a));if(!i.isUnit())throw Error(this.toString()+` and `+e.toString()+` are not co-prime`);return n.compare(0)===-1&&(n=n.add(e)),this.isNegative()?n.negate():n},u.prototype.modInv=l.prototype.modInv=c.prototype.modInv,c.prototype.next=function(){var e=this.value;return this.sign?S(e,1,this.sign):new c(y(e,1),this.sign)},l.prototype.next=function(){var e=this.value;return e+1<r?new l(e+1):new c(i,!1)},u.prototype.next=function(){return new u(this.value+BigInt(1))},c.prototype.prev=function(){var e=this.value;return this.sign?new c(y(e,1),!0):S(e,1,this.sign)},l.prototype.prev=function(){var e=this.value;return e-1>-r?new l(e-1):new c(i,!0)},u.prototype.prev=function(){return new u(this.value-BigInt(1))};for(var oe=[1];2*oe[oe.length-1]<=n;)oe.push(2*oe[oe.length-1]);var j=oe.length,se=oe[j-1];function ce(e){return Math.abs(e)<=n}c.prototype.shiftLeft=function(e){var t=F(e).toJSNumber();if(!ce(t))throw Error(String(t)+` is too large for shifting.`);if(t<0)return this.shiftRight(-t);var n=this;if(n.isZero())return n;for(;t>=j;)n=n.multiply(se),t-=j-1;return n.multiply(oe[t])},u.prototype.shiftLeft=l.prototype.shiftLeft=c.prototype.shiftLeft,c.prototype.shiftRight=function(e){var t,n=F(e).toJSNumber();if(!ce(n))throw Error(String(n)+` is too large for shifting.`);if(n<0)return this.shiftLeft(-n);for(var r=this;n>=j;){if(r.isZero()||r.isNegative()&&r.isUnit())return r;t=A(r,se),r=t[1].isNegative()?t[0].prev():t[0],n-=j-1}return t=A(r,oe[n]),t[1].isNegative()?t[0].prev():t[0]},u.prototype.shiftRight=l.prototype.shiftRight=c.prototype.shiftRight;function le(e,n,r){n=F(n);for(var i=e.isNegative(),a=n.isNegative(),o=i?e.not():e,s=a?n.not():n,c=0,l=0,u=null,d=null,f=[];!o.isZero()||!s.isZero();)u=A(o,se),c=u[1].toJSNumber(),i&&(c=se-1-c),d=A(s,se),l=d[1].toJSNumber(),a&&(l=se-1-l),o=u[0],s=d[0],f.push(r(c,l));for(var p=r(+!!i,+!!a)===0?t(0):t(-1),m=f.length-1;m>=0;--m)p=p.multiply(se).add(t(f[m]));return p}c.prototype.not=function(){return this.negate().prev()},u.prototype.not=l.prototype.not=c.prototype.not,c.prototype.and=function(e){return le(this,e,function(e,t){return e&t})},u.prototype.and=l.prototype.and=c.prototype.and,c.prototype.or=function(e){return le(this,e,function(e,t){return e|t})},u.prototype.or=l.prototype.or=c.prototype.or,c.prototype.xor=function(e){return le(this,e,function(e,t){return e^t})},u.prototype.xor=l.prototype.xor=c.prototype.xor;var M=1<<30,ue=(n&-n)*(n&-n)|M;function de(e){var t=e.value,r=typeof t==`number`?t|M:typeof t==`bigint`?t|BigInt(M):t[0]+t[1]*n|ue;return r&-r}function fe(e,n){if(n.compareTo(e)<=0){var r=fe(e,n.square(n)),i=r.p,a=r.e,o=i.multiply(n);return o.compareTo(e)<=0?{p:o,e:a*2+1}:{p:i,e:a*2}}return{p:t(1),e:0}}c.prototype.bitLength=function(){var e=this;return e.compareTo(t(0))<0&&(e=e.negate().subtract(t(1))),e.compareTo(t(0))===0?t(0):t(fe(e,t(2)).e).add(t(1))},u.prototype.bitLength=l.prototype.bitLength=c.prototype.bitLength;function pe(e,t){return e=F(e),t=F(t),e.greater(t)?e:t}function me(e,t){return e=F(e),t=F(t),e.lesser(t)?e:t}function he(e,t){if(e=F(e).abs(),t=F(t).abs(),e.equals(t))return e;if(e.isZero())return t;if(t.isZero())return e;for(var n=s[1],r,i;e.isEven()&&t.isEven();)r=me(de(e),de(t)),e=e.divide(r),t=t.divide(r),n=n.multiply(r);for(;e.isEven();)e=e.divide(de(e));do{for(;t.isEven();)t=t.divide(de(t));e.greater(t)&&(i=t,t=e,e=i),t=t.subtract(e)}while(!t.isZero());return n.isUnit()?e:e.multiply(n)}function ge(e,t){return e=F(e).abs(),t=F(t).abs(),e.divide(he(e,t)).multiply(t)}function _e(e,t,r){e=F(e),t=F(t);var i=r||Math.random,a=me(e,t),o=pe(e,t).subtract(a).add(1);if(o.isSmall)return a.add(Math.floor(i()*o));for(var c=N(o,n).value,l=[],u=!0,d=0;d<c.length;d++){var f=u?c[d]+(d+1<c.length?c[d+1]/n:0):n,p=g(i()*f);l.push(p),p<c[d]&&(u=!1)}return a.add(s.fromArray(l,n,!1))}var ve=function(e,t,n,r){n||=a,e=String(e),r||(e=e.toLowerCase(),n=n.toLowerCase());var i=e.length,o,s=Math.abs(t),c={};for(o=0;o<n.length;o++)c[n[o]]=o;for(o=0;o<i;o++){var l=e[o];if(l!==`-`&&l in c&&c[l]>=s){if(l===`1`&&s===1)continue;throw Error(l+` is not a valid digit in base `+t+`.`)}}t=F(t);var u=[],d=e[0]===`-`;for(o=+!!d;o<e.length;o++){var l=e[o];if(l in c)u.push(F(c[l]));else if(l===`<`){var f=o;do o++;while(e[o]!==`>`&&o<e.length);u.push(F(e.slice(f+1,o)))}else throw Error(l+` is not a valid character`)}return ye(u,t,d)};function ye(e,t,n){var r=s[0],i=s[1],a;for(a=e.length-1;a>=0;a--)r=r.add(e[a].times(i)),i=i.times(t);return n?r.negate():r}function be(e,t){return t||=a,e<t.length?t[e]:`<`+e+`>`}function N(e,n){if(n=t(n),n.isZero()){if(e.isZero())return{value:[0],isNegative:!1};throw Error(`Cannot convert nonzero numbers to base 0.`)}if(n.equals(-1)){if(e.isZero())return{value:[0],isNegative:!1};if(e.isNegative())return{value:[].concat.apply([],Array.apply(null,Array(-e.toJSNumber())).map(Array.prototype.valueOf,[1,0])),isNegative:!1};var r=Array.apply(null,Array(e.toJSNumber()-1)).map(Array.prototype.valueOf,[0,1]);return r.unshift([1]),{value:[].concat.apply([],r),isNegative:!1}}var i=!1;if(e.isNegative()&&n.isPositive()&&(i=!0,e=e.abs()),n.isUnit())return e.isZero()?{value:[0],isNegative:!1}:{value:Array.apply(null,Array(e.toJSNumber())).map(Number.prototype.valueOf,1),isNegative:i};for(var a=[],o=e,s;o.isNegative()||o.compareAbs(n)>=0;){s=o.divmod(n),o=s.quotient;var c=s.remainder;c.isNegative()&&(c=n.minus(c).abs(),o=o.next()),a.push(c.toJSNumber())}return a.push(o.toJSNumber()),{value:a.reverse(),isNegative:i}}function xe(e,t,n){var r=N(e,t);return(r.isNegative?`-`:``)+r.value.map(function(e){return be(e,n)}).join(``)}c.prototype.toArray=function(e){return N(this,e)},l.prototype.toArray=function(e){return N(this,e)},u.prototype.toArray=function(e){return N(this,e)},c.prototype.toString=function(t,n){if(t===e&&(t=10),t!==10||n)return xe(this,t,n);for(var r=this.value,i=r.length,a=String(r[--i]),o=`0000000`,s;--i>=0;)s=String(r[i]),a+=o.slice(s.length)+s;return(this.sign?`-`:``)+a},l.prototype.toString=function(t,n){return t===e&&(t=10),t!=10||n?xe(this,t,n):String(this.value)},u.prototype.toString=l.prototype.toString,u.prototype.toJSON=c.prototype.toJSON=l.prototype.toJSON=function(){return this.toString()},c.prototype.valueOf=function(){return parseInt(this.toString(),10)},c.prototype.toJSNumber=c.prototype.valueOf,l.prototype.valueOf=function(){return this.value},l.prototype.toJSNumber=l.prototype.valueOf,u.prototype.valueOf=u.prototype.toJSNumber=function(){return parseInt(this.toString(),10)};function P(e){if(d(+e)){var t=+e;if(t===g(t))return o?new u(BigInt(t)):new l(t);throw Error(`Invalid integer: `+e)}var n=e[0]===`-`;n&&(e=e.slice(1));var r=e.split(/e/i);if(r.length>2)throw Error(`Invalid integer: `+r.join(`e`));if(r.length===2){var i=r[1];if(i[0]===`+`&&(i=i.slice(1)),i=+i,i!==g(i)||!d(i))throw Error(`Invalid integer: `+i+` is not a valid exponent.`);var a=r[0],s=a.indexOf(`.`);if(s>=0&&(i-=a.length-s-1,a=a.slice(0,s)+a.slice(s+1)),i<0)throw Error(`Cannot include negative exponent part for integers`);a+=Array(i+1).join(`0`),e=a}if(!/^([0-9][0-9]*)$/.test(e))throw Error(`Invalid integer: `+e);if(o)return new u(BigInt(n?`-`+e:e));for(var f=[],p=e.length,h=7,_=p-h;p>0;)f.push(+e.slice(_,p)),_-=h,_<0&&(_=0),p-=h;return m(f),new c(f,n)}function Se(e){if(o)return new u(BigInt(e));if(d(e)){if(e!==g(e))throw Error(e+` is not an integer.`);return new l(e)}return P(e.toString())}function F(e){return typeof e==`number`?Se(e):typeof e==`string`?P(e):typeof e==`bigint`?new u(e):e}for(var Ce=0;Ce<1e3;Ce++)s[Ce]=F(Ce),Ce>0&&(s[-Ce]=F(-Ce));return s.one=s[1],s.zero=s[0],s.minusOne=s[-1],s.max=pe,s.min=me,s.gcd=he,s.lcm=ge,s.isInstance=function(e){return e instanceof c||e instanceof l||e instanceof u},s.randBetween=_e,s.fromArray=function(e,t,n){return ye(e.map(F),F(t||10),n)},s})();e.hasOwnProperty(`exports`)&&(e.exports=t)})(An),An.exports)}var Nn=ge(Mn()),Pn=64,Fn=16,In=Pn/Fn;function Ln(){try{return!0}catch{return!1}}function Rn(e,t,n){let r=0;for(let i=0;i<n;i++){let n=e[t+i];if(n===void 0)break;r+=n*16**i}return r}function zn(e){let t=[];for(let n=0;n<e.length;n++){let r=Number(e[n]);for(let e=0;r||e<t.length;e++)r+=(t[e]||0)*10,t[e]=r%16,r=(r-t[e])/16}return t}function Bn(e){let t=zn(e),n=Array(In);for(let e=0;e<In;e++)n[In-1-e]=Rn(t,e*In,In);return n}var Vn=class e{static fromString(t){return new e(Bn(t),t)}static fromBit(t){let n=Array(In),r=Math.floor(t/Fn);for(let e=0;e<In;e++)n[In-1-e]=e===r?1<<t-r*Fn:0;return new e(n)}constructor(e,t){this.parts=e,this.str=t}and({parts:t}){return new e(this.parts.map((e,n)=>e&t[n]))}or({parts:t}){return new e(this.parts.map((e,n)=>e|t[n]))}xor({parts:t}){return new e(this.parts.map((e,n)=>e^t[n]))}not(){return new e(this.parts.map(e=>~e))}equals({parts:e}){return this.parts.every((t,n)=>t===e[n])}toString(){if(this.str!=null)return this.str;let e=Array(Pn/4);return this.parts.forEach((t,n)=>{let r=zn(t.toString());for(let t=0;t<4;t++)e[t+n*4]=r[3-t]||0}),this.str=Nn.fromArray(e,16).toString()}toJSON(){return this.toString()}},Hn=Ln();Hn&&BigInt.prototype.toJSON==null&&(BigInt.prototype.toJSON=function(){return this.toString()});var Un={},Wn=Hn?function(e){return BigInt(e)}:function(e){return e instanceof Vn?e:(typeof e==`number`&&(e=e.toString()),Un[e]??(Un[e]=Vn.fromString(e)),Un[e])},Gn=Wn(0),Kn=Hn?function(e=Gn,t=Gn){return e&t}:function(e=Gn,t=Gn){return e.and(t)},qn=Hn?function(e=Gn,t=Gn){return e|t}:function(e=Gn,t=Gn){return e.or(t)},Jn=Hn?function(e=Gn,t=Gn){return e^t}:function(e=Gn,t=Gn){return e.xor(t)},Yn=Hn?function(e=Gn){return~e}:function(e=Gn){return e.not()},Xn=Hn?function(e,t){return e===t}:function(e,t){return e==null||t==null?e==t:e.equals(t)};function Zn(...e){let t=e[0];for(let n=1;n<e.length;n++)t=qn(t,e[n]);return t}function Qn(e,t){return Xn(Kn(e,t),t)}function $n(e,t){return!Xn(Kn(e,t),Gn)}function er(e,t){return t===Gn?e:qn(e,t)}function tr(e,t){return t===Gn?e:Jn(e,Kn(e,t))}var nr={combine:Zn,add:er,remove:tr,filter:Kn,invert:Yn,has:Qn,hasAny:$n,equals:Xn,deserialize:Wn,getFlag:Hn?function(e){return BigInt(1)<<BigInt(e)}:function(e){return Vn.fromBit(e)}},rr;(function(e){e[e.CLOSE_NORMAL=1e3]=`CLOSE_NORMAL`,e[e.CLOSE_UNSUPPORTED=1003]=`CLOSE_UNSUPPORTED`,e[e.CLOSE_ABNORMAL=1006]=`CLOSE_ABNORMAL`,e[e.INVALID_CLIENTID=4e3]=`INVALID_CLIENTID`,e[e.INVALID_ORIGIN=4001]=`INVALID_ORIGIN`,e[e.RATELIMITED=4002]=`RATELIMITED`,e[e.TOKEN_REVOKED=4003]=`TOKEN_REVOKED`,e[e.INVALID_VERSION=4004]=`INVALID_VERSION`,e[e.INVALID_ENCODING=4005]=`INVALID_ENCODING`})(rr||={});var ir;(function(e){e[e.INVALID_PAYLOAD=4e3]=`INVALID_PAYLOAD`,e[e.INVALID_COMMAND=4002]=`INVALID_COMMAND`,e[e.INVALID_GUILD=4003]=`INVALID_GUILD`,e[e.INVALID_EVENT=4004]=`INVALID_EVENT`,e[e.INVALID_CHANNEL=4005]=`INVALID_CHANNEL`,e[e.INVALID_PERMISSIONS=4006]=`INVALID_PERMISSIONS`,e[e.INVALID_CLIENTID=4007]=`INVALID_CLIENTID`,e[e.INVALID_ORIGIN=4008]=`INVALID_ORIGIN`,e[e.INVALID_TOKEN=4009]=`INVALID_TOKEN`,e[e.INVALID_USER=4010]=`INVALID_USER`})(ir||={});var ar;(function(e){e.LANDSCAPE=`landscape`,e.PORTRAIT=`portrait`})(ar||={});var or;(function(e){e.MOBILE=`mobile`,e.DESKTOP=`desktop`})(or||={}),Object.freeze({CREATE_INSTANT_INVITE:nr.getFlag(0),KICK_MEMBERS:nr.getFlag(1),BAN_MEMBERS:nr.getFlag(2),ADMINISTRATOR:nr.getFlag(3),MANAGE_CHANNELS:nr.getFlag(4),MANAGE_GUILD:nr.getFlag(5),ADD_REACTIONS:nr.getFlag(6),VIEW_AUDIT_LOG:nr.getFlag(7),PRIORITY_SPEAKER:nr.getFlag(8),STREAM:nr.getFlag(9),VIEW_CHANNEL:nr.getFlag(10),SEND_MESSAGES:nr.getFlag(11),SEND_TTS_MESSAGES:nr.getFlag(12),MANAGE_MESSAGES:nr.getFlag(13),EMBED_LINKS:nr.getFlag(14),ATTACH_FILES:nr.getFlag(15),READ_MESSAGE_HISTORY:nr.getFlag(16),MENTION_EVERYONE:nr.getFlag(17),USE_EXTERNAL_EMOJIS:nr.getFlag(18),VIEW_GUILD_INSIGHTS:nr.getFlag(19),CONNECT:nr.getFlag(20),SPEAK:nr.getFlag(21),MUTE_MEMBERS:nr.getFlag(22),DEAFEN_MEMBERS:nr.getFlag(23),MOVE_MEMBERS:nr.getFlag(24),USE_VAD:nr.getFlag(25),CHANGE_NICKNAME:nr.getFlag(26),MANAGE_NICKNAMES:nr.getFlag(27),MANAGE_ROLES:nr.getFlag(28),MANAGE_WEBHOOKS:nr.getFlag(29),MANAGE_GUILD_EXPRESSIONS:nr.getFlag(30),USE_APPLICATION_COMMANDS:nr.getFlag(31),REQUEST_TO_SPEAK:nr.getFlag(32),MANAGE_EVENTS:nr.getFlag(33),MANAGE_THREADS:nr.getFlag(34),CREATE_PUBLIC_THREADS:nr.getFlag(35),CREATE_PRIVATE_THREADS:nr.getFlag(36),USE_EXTERNAL_STICKERS:nr.getFlag(37),SEND_MESSAGES_IN_THREADS:nr.getFlag(38),USE_EMBEDDED_ACTIVITIES:nr.getFlag(39),MODERATE_MEMBERS:nr.getFlag(40),VIEW_CREATOR_MONETIZATION_ANALYTICS:nr.getFlag(41),USE_SOUNDBOARD:nr.getFlag(42),CREATE_GUILD_EXPRESSIONS:nr.getFlag(43),CREATE_EVENTS:nr.getFlag(44),USE_EXTERNAL_SOUNDS:nr.getFlag(45),SEND_VOICE_MESSAGES:nr.getFlag(46),SEND_POLLS:nr.getFlag(49),USE_EXTERNAL_APPS:nr.getFlag(50)});function sr(e){return On(t=>{let[n]=Object.entries(e).find(([,e])=>e===t)??[];return t!=null&&n===void 0?e.UNHANDLED:t},H().or(U()))}function cr(e){let t=Yt().transform(t=>{let n=e.safeParse(t);return n.success?n.data:e._def.defaultValue()});return t.overlayType=e,t}var lr=K.object({image_url:K.string()}).describe(`Response for "INITIATE_IMAGE_UPLOAD" Command`),ur=K.object({mediaUrl:K.string().max(1024)}).describe(`Request for "OPEN_SHARE_MOMENT_DIALOG" Command`),dr=K.object({access_token:K.union([K.string(),K.null()]).optional()}).describe(`Request for "AUTHENTICATE" Command`),fr=K.object({access_token:K.string(),user:K.object({username:K.string(),discriminator:K.string(),id:K.string(),avatar:K.union([K.string(),K.null()]).optional(),public_flags:K.number(),global_name:K.union([K.string(),K.null()]).optional()}),scopes:K.array(cr(K.enum(`identify,identify.premium,email,connections,guilds,guilds.join,guilds.members.read,guilds.channels.read,gdm.join,bot,rpc,rpc.notifications.read,rpc.voice.read,rpc.voice.write,rpc.video.read,rpc.video.write,rpc.screenshare.read,rpc.screenshare.write,rpc.activities.write,webhook.incoming,messages.read,applications.builds.upload,applications.builds.read,applications.commands,applications.commands.permissions.update,applications.commands.update,applications.store.update,applications.entitlements,activities.read,activities.write,activities.invites.write,relationships.read,relationships.write,voice,dm_channels.read,role_connections.write,presences.read,presences.write,openid,dm_channels.messages.read,dm_channels.messages.write,gateway.connect,account.global_name.update,payment_sources.country_code,sdk.social_layer_presence,sdk.social_layer,lobbies.write,application_identities.write`.split(`,`)).or(K.literal(-1)).default(-1))),expires:K.string(),application:K.object({description:K.string(),icon:K.union([K.string(),K.null()]).optional(),id:K.string(),rpc_origins:K.array(K.string()).optional(),name:K.string()})}).describe(`Response for "AUTHENTICATE" Command`),pr=K.object({participants:K.array(K.object({id:K.string(),username:K.string(),global_name:K.union([K.string(),K.null()]).optional(),discriminator:K.string(),avatar:K.union([K.string(),K.null()]).optional(),flags:K.number(),bot:K.boolean(),avatar_decoration_data:K.union([K.object({asset:K.union([K.string(),K.null()]).optional(),skuId:K.string().optional(),expiresAt:K.number().optional()}),K.null()]).optional(),premium_type:K.union([K.number(),K.null()]).optional(),nickname:K.string().optional()}))}).describe(`Response for "GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS" Command`),mr=K.object({command:K.string(),options:K.array(K.object({name:K.string(),value:K.string()})).optional(),content:K.string().max(2e3).optional(),require_launch_channel:K.boolean().optional(),preview_image:K.object({height:K.number(),url:K.string(),width:K.number()}).optional(),components:K.array(K.object({type:K.literal(1),components:K.array(K.object({type:K.literal(2),style:K.number().gte(1).lte(5),label:K.string().max(80).optional(),custom_id:K.string().max(100).describe(`Developer-defined identifier for the button; max 100 characters`).optional()})).max(5).optional()})).optional(),pid:K.number().optional()}).describe(`Request for "SHARE_INTERACTION" Command`),hr=K.object({success:K.boolean()}).describe(`Response for "SHARE_INTERACTION" Command`),gr=K.object({custom_id:K.string().max(64).optional(),message:K.string().max(1e3),link_id:K.string().max(64).optional()}).describe(`Request for "SHARE_LINK" Command`),_r=K.object({success:K.boolean(),didCopyLink:K.boolean(),didSendMessage:K.boolean()}).describe(`Response for "SHARE_LINK" Command`),vr=K.object({relationships:K.array(K.object({type:K.number(),user:K.object({id:K.string(),username:K.string(),global_name:K.union([K.string(),K.null()]).optional(),discriminator:K.string(),avatar:K.union([K.string(),K.null()]).optional(),flags:K.number(),bot:K.boolean(),avatar_decoration_data:K.union([K.object({asset:K.union([K.string(),K.null()]).optional(),skuId:K.string().optional(),expiresAt:K.number().optional()}),K.null()]).optional(),premium_type:K.union([K.number(),K.null()]).optional()}),presence:K.object({status:K.string(),activity:K.union([K.object({session_id:K.string().optional(),type:K.number().optional(),name:K.string(),url:K.union([K.string(),K.null()]).optional(),application_id:K.string().optional(),status_display_type:K.number().optional(),state:K.string().optional(),state_url:K.string().optional(),details:K.string().optional(),details_url:K.string().optional(),emoji:K.union([K.object({name:K.string(),id:K.union([K.string(),K.null()]).optional(),animated:K.union([K.boolean(),K.null()]).optional()}),K.null()]).optional(),assets:K.object({large_image:K.string().optional(),large_text:K.string().optional(),large_url:K.string().optional(),small_image:K.string().optional(),small_text:K.string().optional(),small_url:K.string().optional()}).optional(),timestamps:K.object({start:K.number().optional(),end:K.number().optional()}).optional(),party:K.object({id:K.string().optional(),size:K.array(K.number()).min(2).max(2).optional(),privacy:K.number().optional()}).optional(),secrets:K.object({match:K.string().optional(),join:K.string().optional()}).optional(),sync_id:K.string().optional(),created_at:K.number().optional(),instance:K.boolean().optional(),flags:K.number().optional(),metadata:K.object({}).optional(),platform:K.string().optional(),supported_platforms:K.array(K.string()).optional(),buttons:K.array(K.string()).optional(),hangStatus:K.string().optional()}),K.null()]).optional()}).optional()}))}).describe(`Response for "GET_RELATIONSHIPS" Command`),yr=K.object({user_id:K.string(),content:K.string().min(0).max(1024).optional()}).describe(`Request for "INVITE_USER_EMBEDDED" Command`),br=K.object({id:K.string().max(64)}).describe(`Request for "GET_USER" Command`),xr=K.union([K.object({id:K.string(),username:K.string(),global_name:K.union([K.string(),K.null()]).optional(),discriminator:K.string(),avatar:K.union([K.string(),K.null()]).optional(),flags:K.number(),bot:K.boolean(),avatar_decoration_data:K.union([K.object({asset:K.union([K.string(),K.null()]).optional(),skuId:K.string().optional(),expiresAt:K.number().optional()}),K.null()]).optional(),premium_type:K.union([K.number(),K.null()]).optional()}),K.null()]),Sr=K.object({quest_id:K.string()}).describe(`Request for "GET_QUEST_ENROLLMENT_STATUS" Command`),Cr=K.object({quest_id:K.string(),is_enrolled:K.boolean(),enrolled_at:K.union([K.string(),K.null()]).optional()}).describe(`Response for "GET_QUEST_ENROLLMENT_STATUS" Command`),wr=K.object({quest_id:K.string()}).describe(`Request for "QUEST_START_TIMER" Command`),Tr=K.object({success:K.boolean()}).describe(`Response for "QUEST_START_TIMER" Command`),Er=K.object({quest_id:K.string(),enrolled_at:K.union([K.string(),K.null()]).optional(),completed_at:K.union([K.string(),K.null()]).optional(),external_cta_url:K.string()}).describe(`Response for "GET_QUEST" Command`),Dr=K.object({ticket:K.string()}).describe(`Response for "REQUEST_PROXY_TICKET_REFRESH" Command`),Or;(function(e){e.INITIATE_IMAGE_UPLOAD=`INITIATE_IMAGE_UPLOAD`,e.OPEN_SHARE_MOMENT_DIALOG=`OPEN_SHARE_MOMENT_DIALOG`,e.AUTHENTICATE=`AUTHENTICATE`,e.GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS=`GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS`,e.SHARE_INTERACTION=`SHARE_INTERACTION`,e.SHARE_LINK=`SHARE_LINK`,e.GET_RELATIONSHIPS=`GET_RELATIONSHIPS`,e.INVITE_USER_EMBEDDED=`INVITE_USER_EMBEDDED`,e.GET_USER=`GET_USER`,e.GET_QUEST_ENROLLMENT_STATUS=`GET_QUEST_ENROLLMENT_STATUS`,e.QUEST_START_TIMER=`QUEST_START_TIMER`,e.GET_QUEST=`GET_QUEST`,e.REQUEST_PROXY_TICKET_REFRESH=`REQUEST_PROXY_TICKET_REFRESH`})(Or||={});var kr=K.object({}).optional().nullable(),Ar=K.void(),jr={[Or.INITIATE_IMAGE_UPLOAD]:{request:Ar,response:lr},[Or.OPEN_SHARE_MOMENT_DIALOG]:{request:ur,response:kr},[Or.AUTHENTICATE]:{request:dr,response:fr},[Or.GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS]:{request:Ar,response:pr},[Or.SHARE_INTERACTION]:{request:mr,response:hr},[Or.SHARE_LINK]:{request:gr,response:_r},[Or.GET_RELATIONSHIPS]:{request:Ar,response:vr},[Or.INVITE_USER_EMBEDDED]:{request:yr,response:kr},[Or.GET_USER]:{request:br,response:xr},[Or.GET_QUEST_ENROLLMENT_STATUS]:{request:Sr,response:Cr},[Or.QUEST_START_TIMER]:{request:wr,response:Tr},[Or.GET_QUEST]:{request:Ar,response:Er},[Or.REQUEST_PROXY_TICKET_REFRESH]:{request:Ar,response:Dr}},Mr=t({Activity:()=>Kr,Attachment:()=>ti,CertifiedDevice:()=>xi,CertifiedDeviceTypeObject:()=>bi,Channel:()=>Xr,ChannelMention:()=>ei,ChannelTypesObject:()=>Yr,Commands:()=>q,DISPATCH:()=>Nr,Embed:()=>ci,EmbedAuthor:()=>oi,EmbedField:()=>si,EmbedFooter:()=>ni,EmbedProvider:()=>ai,Emoji:()=>Vr,Entitlement:()=>Ti,EntitlementTypesObject:()=>wi,Guild:()=>$r,GuildMember:()=>zr,GuildMemberRPC:()=>Br,Image:()=>ri,KeyTypesObject:()=>hi,LayoutMode:()=>Ni,LayoutModeTypeObject:()=>Mi,Message:()=>pi,MessageActivity:()=>ui,MessageApplication:()=>di,MessageReference:()=>fi,Orientation:()=>ji,OrientationLockState:()=>Di,OrientationLockStateTypeObject:()=>Ei,OrientationTypeObject:()=>Ai,PermissionOverwrite:()=>Jr,PermissionOverwriteTypeObject:()=>qr,PresenceUpdate:()=>Zr,Reaction:()=>li,ReceiveFramePayload:()=>Pr,Relationship:()=>Lr,Role:()=>Qr,Scopes:()=>Ir,ScopesObject:()=>Fr,ShortcutKey:()=>gi,Sku:()=>Ci,SkuTypeObject:()=>Si,Status:()=>Gr,StatusObject:()=>Wr,ThermalState:()=>ki,ThermalStateTypeObject:()=>Oi,User:()=>Rr,UserVoiceState:()=>Ur,Video:()=>ii,VoiceDevice:()=>mi,VoiceSettingModeTypeObject:()=>_i,VoiceSettingsIO:()=>yi,VoiceSettingsMode:()=>vi,VoiceState:()=>Hr}),Nr=`DISPATCH`,q;(function(e){e.AUTHORIZE=`AUTHORIZE`,e.GET_GUILDS=`GET_GUILDS`,e.GET_GUILD=`GET_GUILD`,e.GET_CHANNEL=`GET_CHANNEL`,e.GET_CHANNELS=`GET_CHANNELS`,e.SELECT_VOICE_CHANNEL=`SELECT_VOICE_CHANNEL`,e.SELECT_TEXT_CHANNEL=`SELECT_TEXT_CHANNEL`,e.SUBSCRIBE=`SUBSCRIBE`,e.UNSUBSCRIBE=`UNSUBSCRIBE`,e.CAPTURE_SHORTCUT=`CAPTURE_SHORTCUT`,e.SET_CERTIFIED_DEVICES=`SET_CERTIFIED_DEVICES`,e.SET_ACTIVITY=`SET_ACTIVITY`,e.GET_SKUS=`GET_SKUS`,e.GET_ENTITLEMENTS=`GET_ENTITLEMENTS`,e.GET_SKUS_EMBEDDED=`GET_SKUS_EMBEDDED`,e.GET_ENTITLEMENTS_EMBEDDED=`GET_ENTITLEMENTS_EMBEDDED`,e.START_PURCHASE=`START_PURCHASE`,e.SET_CONFIG=`SET_CONFIG`,e.SEND_ANALYTICS_EVENT=`SEND_ANALYTICS_EVENT`,e.USER_SETTINGS_GET_LOCALE=`USER_SETTINGS_GET_LOCALE`,e.OPEN_EXTERNAL_LINK=`OPEN_EXTERNAL_LINK`,e.ENCOURAGE_HW_ACCELERATION=`ENCOURAGE_HW_ACCELERATION`,e.CAPTURE_LOG=`CAPTURE_LOG`,e.SET_ORIENTATION_LOCK_STATE=`SET_ORIENTATION_LOCK_STATE`,e.OPEN_INVITE_DIALOG=`OPEN_INVITE_DIALOG`,e.GET_PLATFORM_BEHAVIORS=`GET_PLATFORM_BEHAVIORS`,e.GET_CHANNEL_PERMISSIONS=`GET_CHANNEL_PERMISSIONS`,e.AUTHENTICATE=`AUTHENTICATE`,e.GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS=`GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS`,e.GET_QUEST=`GET_QUEST`,e.GET_QUEST_ENROLLMENT_STATUS=`GET_QUEST_ENROLLMENT_STATUS`,e.GET_RELATIONSHIPS=`GET_RELATIONSHIPS`,e.GET_USER=`GET_USER`,e.INITIATE_IMAGE_UPLOAD=`INITIATE_IMAGE_UPLOAD`,e.INVITE_USER_EMBEDDED=`INVITE_USER_EMBEDDED`,e.OPEN_SHARE_MOMENT_DIALOG=`OPEN_SHARE_MOMENT_DIALOG`,e.QUEST_START_TIMER=`QUEST_START_TIMER`,e.REQUEST_PROXY_TICKET_REFRESH=`REQUEST_PROXY_TICKET_REFRESH`,e.SHARE_INTERACTION=`SHARE_INTERACTION`,e.SHARE_LINK=`SHARE_LINK`})(q||={});var Pr=G({cmd:H(),data:sn(),evt:an(),nonce:H()}).passthrough(),Fr=Object.assign(Object.assign({},fr.shape.scopes.element.overlayType._def.innerType.options[0].Values),{UNHANDLED:-1}),Ir=sr(Fr),Lr=vr.shape.relationships.element,Rr=G({id:H(),username:H(),discriminator:H(),global_name:H().optional().nullable(),avatar:H().optional().nullable(),avatar_decoration_data:G({asset:H(),sku_id:H().optional()}).nullable(),bot:W(),flags:U().optional().nullable(),premium_type:U().optional().nullable()}),zr=G({user:Rr,nick:H().optional().nullable(),roles:un(H()),joined_at:H(),deaf:W(),mute:W()}),Br=G({user_id:H(),nick:H().optional().nullable(),guild_id:H(),avatar:H().optional().nullable(),avatar_decoration_data:G({asset:H(),sku_id:H().optional().nullable()}).optional().nullable(),color_string:H().optional().nullable()}),Vr=G({id:H(),name:H().optional().nullable(),roles:un(H()).optional().nullable(),user:Rr.optional().nullable(),require_colons:W().optional().nullable(),managed:W().optional().nullable(),animated:W().optional().nullable(),available:W().optional().nullable()}),Hr=G({mute:W(),deaf:W(),self_mute:W(),self_deaf:W(),suppress:W()}),Ur=G({mute:W(),nick:H(),user:Rr,voice_state:Hr,volume:U()}),Wr={UNHANDLED:-1,IDLE:`idle`,DND:`dnd`,ONLINE:`online`,OFFLINE:`offline`},Gr=sr(Wr),Kr=G({name:H(),type:U(),url:H().optional().nullable(),created_at:U().optional().nullable(),timestamps:G({start:U(),end:U()}).partial().optional().nullable(),application_id:H().optional().nullable(),details:H().optional().nullable(),details_url:H().url().optional().nullable(),state:H().optional().nullable(),state_url:H().url().optional().nullable(),emoji:Vr.optional().nullable(),party:G({id:H().optional().nullable(),size:un(U()).optional().nullable()}).optional().nullable(),assets:G({large_image:H().nullable(),large_text:H().nullable(),large_url:H().url().optional().nullable(),small_image:H().nullable(),small_text:H().nullable(),small_url:H().url().optional().nullable()}).partial().optional().nullable(),secrets:G({join:H(),match:H()}).partial().optional().nullable(),instance:W().optional().nullable(),flags:U().optional().nullable()}),qr={UNHANDLED:-1,ROLE:0,MEMBER:1},Jr=G({id:H(),type:sr(qr),allow:H(),deny:H()}),Yr={UNHANDLED:-1,DM:1,GROUP_DM:3,GUILD_TEXT:0,GUILD_VOICE:2,GUILD_CATEGORY:4,GUILD_ANNOUNCEMENT:5,GUILD_STORE:6,ANNOUNCEMENT_THREAD:10,PUBLIC_THREAD:11,PRIVATE_THREAD:12,GUILD_STAGE_VOICE:13,GUILD_DIRECTORY:14,GUILD_FORUM:15},Xr=G({id:H(),type:sr(Yr),guild_id:H().optional().nullable(),position:U().optional().nullable(),permission_overwrites:un(Jr).optional().nullable(),name:H().optional().nullable(),topic:H().optional().nullable(),nsfw:W().optional().nullable(),last_message_id:H().optional().nullable(),bitrate:U().optional().nullable(),user_limit:U().optional().nullable(),rate_limit_per_user:U().optional().nullable(),recipients:un(Rr).optional().nullable(),icon:H().optional().nullable(),owner_id:H().optional().nullable(),application_id:H().optional().nullable(),parent_id:H().optional().nullable(),last_pin_timestamp:H().optional().nullable()}),Zr=G({user:Rr,guild_id:H(),status:Gr,activities:un(Kr),client_status:G({desktop:Gr,mobile:Gr,web:Gr}).partial()}),Qr=G({id:H(),name:H(),color:U(),hoist:W(),position:U(),permissions:H(),managed:W(),mentionable:W()}),$r=G({id:H(),name:H(),owner_id:H(),icon:H().nullable(),icon_hash:H().optional().nullable(),splash:H().nullable(),discovery_splash:H().nullable(),owner:W().optional().nullable(),permissions:H().optional().nullable(),region:H(),afk_channel_id:H().nullable(),afk_timeout:U(),widget_enabled:W().optional().nullable(),widget_channel_id:H().optional().nullable(),verification_level:U(),default_message_notifications:U(),explicit_content_filter:U(),roles:un(Qr),emojis:un(Vr),features:un(H()),mfa_level:U(),application_id:H().nullable(),system_channel_id:H().nullable(),system_channel_flags:U(),rules_channel_id:H().nullable(),joined_at:H().optional().nullable(),large:W().optional().nullable(),unavailable:W().optional().nullable(),member_count:U().optional().nullable(),voice_states:un(Hr).optional().nullable(),members:un(zr).optional().nullable(),channels:un(Xr).optional().nullable(),presences:un(Zr).optional().nullable(),max_presences:U().optional().nullable(),max_members:U().optional().nullable(),vanity_url_code:H().nullable(),description:H().nullable(),banner:H().nullable(),premium_tier:U(),premium_subscription_count:U().optional().nullable(),preferred_locale:H(),public_updates_channel_id:H().nullable(),max_video_channel_users:U().optional().nullable(),approximate_member_count:U().optional().nullable(),approximate_presence_count:U().optional().nullable()}),ei=G({id:H(),guild_id:H(),type:U(),name:H()}),ti=G({id:H(),filename:H(),size:U(),url:H(),proxy_url:H(),height:U().optional().nullable(),width:U().optional().nullable()}),ni=G({text:H(),icon_url:H().optional().nullable(),proxy_icon_url:H().optional().nullable()}),ri=G({url:H().optional().nullable(),proxy_url:H().optional().nullable(),height:U().optional().nullable(),width:U().optional().nullable()}),ii=ri.omit({proxy_url:!0}),ai=G({name:H().optional().nullable(),url:H().optional().nullable()}),oi=G({name:H().optional().nullable(),url:H().optional().nullable(),icon_url:H().optional().nullable(),proxy_icon_url:H().optional().nullable()}),si=G({name:H(),value:H(),inline:W()}),ci=G({title:H().optional().nullable(),type:H().optional().nullable(),description:H().optional().nullable(),url:H().optional().nullable(),timestamp:H().optional().nullable(),color:U().optional().nullable(),footer:ni.optional().nullable(),image:ri.optional().nullable(),thumbnail:ri.optional().nullable(),video:ii.optional().nullable(),provider:ai.optional().nullable(),author:oi.optional().nullable(),fields:un(si).optional().nullable()}),li=G({count:U(),me:W(),emoji:Vr}),ui=G({type:U(),party_id:H().optional().nullable()}),di=G({id:H(),cover_image:H().optional().nullable(),description:H(),icon:H().optional().nullable(),name:H()}),fi=G({message_id:H().optional().nullable(),channel_id:H().optional().nullable(),guild_id:H().optional().nullable()}),pi=G({id:H(),channel_id:H(),guild_id:H().optional().nullable(),author:Rr.optional().nullable(),member:zr.optional().nullable(),content:H(),timestamp:H(),edited_timestamp:H().optional().nullable(),tts:W(),mention_everyone:W(),mentions:un(Rr),mention_roles:un(H()),mention_channels:un(ei),attachments:un(ti),embeds:un(ci),reactions:un(li).optional().nullable(),nonce:fn([H(),U()]).optional().nullable(),pinned:W(),webhook_id:H().optional().nullable(),type:U(),activity:ui.optional().nullable(),application:di.optional().nullable(),message_reference:fi.optional().nullable(),flags:U().optional().nullable(),stickers:un(sn()).optional().nullable(),referenced_message:sn().optional().nullable()}),mi=G({id:H(),name:H()}),hi={UNHANDLED:-1,KEYBOARD_KEY:0,MOUSE_BUTTON:1,KEYBOARD_MODIFIER_KEY:2,GAMEPAD_BUTTON:3},gi=G({type:sr(hi),code:U(),name:H()}),_i={UNHANDLED:-1,PUSH_TO_TALK:`PUSH_TO_TALK`,VOICE_ACTIVITY:`VOICE_ACTIVITY`},vi=G({type:sr(_i),auto_threshold:W(),threshold:U(),shortcut:un(gi),delay:U()}),yi=G({device_id:H(),volume:U(),available_devices:un(mi)}),bi={UNHANDLED:-1,AUDIO_INPUT:`AUDIO_INPUT`,AUDIO_OUTPUT:`AUDIO_OUTPUT`,VIDEO_INPUT:`VIDEO_INPUT`},xi=G({type:sr(bi),id:H(),vendor:G({name:H(),url:H()}),model:G({name:H(),url:H()}),related:un(H()),echo_cancellation:W().optional().nullable(),noise_suppression:W().optional().nullable(),automatic_gain_control:W().optional().nullable(),hardware_mute:W().optional().nullable()}),Si={UNHANDLED:-1,APPLICATION:1,DLC:2,CONSUMABLE:3,BUNDLE:4,SUBSCRIPTION:5},Ci=G({id:H(),name:H(),type:sr(Si),price:G({amount:U(),currency:H()}),application_id:H(),flags:U(),release_date:H().nullable()}),wi={UNHANDLED:-1,PURCHASE:1,PREMIUM_SUBSCRIPTION:2,DEVELOPER_GIFT:3,TEST_MODE_PURCHASE:4,FREE_PURCHASE:5,USER_GIFT:6,PREMIUM_PURCHASE:7},Ti=G({id:H(),sku_id:H(),application_id:H(),user_id:H(),gift_code_flags:U(),type:sr(wi),gifter_user_id:H().optional().nullable(),branches:un(H()).optional().nullable(),starts_at:H().optional().nullable(),ends_at:H().optional().nullable(),parent_id:H().optional().nullable(),consumed:W().optional().nullable(),deleted:W().optional().nullable(),gift_code_batch_id:H().optional().nullable()}),Ei={UNHANDLED:-1,UNLOCKED:1,PORTRAIT:2,LANDSCAPE:3},Di=sr(Ei),Oi={UNHANDLED:-1,NOMINAL:0,FAIR:1,SERIOUS:2,CRITICAL:3},ki=sr(Oi),Ai={UNHANDLED:-1,PORTRAIT:0,LANDSCAPE:1},ji=sr(Ai),Mi={UNHANDLED:-1,FOCUSED:0,PIP:1,GRID:2},Ni=sr(Mi),Pi=`ERROR`,Fi;(function(e){e.READY=`READY`,e.VOICE_STATE_UPDATE=`VOICE_STATE_UPDATE`,e.SPEAKING_START=`SPEAKING_START`,e.SPEAKING_STOP=`SPEAKING_STOP`,e.ACTIVITY_LAYOUT_MODE_UPDATE=`ACTIVITY_LAYOUT_MODE_UPDATE`,e.ORIENTATION_UPDATE=`ORIENTATION_UPDATE`,e.CURRENT_USER_UPDATE=`CURRENT_USER_UPDATE`,e.CURRENT_GUILD_MEMBER_UPDATE=`CURRENT_GUILD_MEMBER_UPDATE`,e.ENTITLEMENT_CREATE=`ENTITLEMENT_CREATE`,e.THERMAL_STATE_UPDATE=`THERMAL_STATE_UPDATE`,e.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE=`ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE`,e.RELATIONSHIP_UPDATE=`RELATIONSHIP_UPDATE`,e.ACTIVITY_JOIN=`ACTIVITY_JOIN`,e.QUEST_ENROLLMENT_STATUS_UPDATE=`QUEST_ENROLLMENT_STATUS_UPDATE`})(Fi||={});var Ii=Pr.extend({evt:Cn(Fi),nonce:H().nullable(),cmd:xn(Nr),data:G({}).passthrough()}),Li=Pr.extend({evt:xn(Pi),data:G({code:U(),message:H().optional()}).passthrough(),cmd:Cn(q),nonce:H().nullable()}),Ri=fn([Ii,Ii.extend({evt:H()}),Li]);function zi(e){let t=e.evt;if(!(t in Fi))throw Error(`Unrecognized event type ${e.evt}`);return Bi[t].payload.parse(e)}var Bi={[Fi.READY]:{payload:Ii.extend({evt:xn(Fi.READY),data:G({v:U(),config:G({cdn_host:H().optional(),api_endpoint:H(),environment:H()}),user:G({id:H(),username:H(),discriminator:H(),avatar:H().optional()}).optional()})})},[Fi.VOICE_STATE_UPDATE]:{payload:Ii.extend({evt:xn(Fi.VOICE_STATE_UPDATE),data:Ur}),subscribeArgs:G({channel_id:H()})},[Fi.SPEAKING_START]:{payload:Ii.extend({evt:xn(Fi.SPEAKING_START),data:G({lobby_id:H().optional(),channel_id:H().optional(),user_id:H()})}),subscribeArgs:G({lobby_id:H().nullable().optional(),channel_id:H().nullable().optional()})},[Fi.SPEAKING_STOP]:{payload:Ii.extend({evt:xn(Fi.SPEAKING_STOP),data:G({lobby_id:H().optional(),channel_id:H().optional(),user_id:H()})}),subscribeArgs:G({lobby_id:H().nullable().optional(),channel_id:H().nullable().optional()})},[Fi.ACTIVITY_LAYOUT_MODE_UPDATE]:{payload:Ii.extend({evt:xn(Fi.ACTIVITY_LAYOUT_MODE_UPDATE),data:G({layout_mode:sr(Mi)})})},[Fi.ORIENTATION_UPDATE]:{payload:Ii.extend({evt:xn(Fi.ORIENTATION_UPDATE),data:G({screen_orientation:sr(Ai),orientation:Cn(ar)})})},[Fi.CURRENT_USER_UPDATE]:{payload:Ii.extend({evt:xn(Fi.CURRENT_USER_UPDATE),data:Rr})},[Fi.CURRENT_GUILD_MEMBER_UPDATE]:{payload:Ii.extend({evt:xn(Fi.CURRENT_GUILD_MEMBER_UPDATE),data:Br}),subscribeArgs:G({guild_id:H()})},[Fi.ENTITLEMENT_CREATE]:{payload:Ii.extend({evt:xn(Fi.ENTITLEMENT_CREATE),data:G({entitlement:Ti})})},[Fi.THERMAL_STATE_UPDATE]:{payload:Ii.extend({evt:xn(Fi.THERMAL_STATE_UPDATE),data:G({thermal_state:ki})})},[Fi.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE]:{payload:Ii.extend({evt:xn(Fi.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE),data:G({participants:pr.shape.participants})})},[Fi.RELATIONSHIP_UPDATE]:{payload:Ii.extend({evt:xn(Fi.RELATIONSHIP_UPDATE),data:Lr})},[Fi.ACTIVITY_JOIN]:{payload:Ii.extend({evt:xn(Fi.ACTIVITY_JOIN),data:G({applicationId:H(),secret:H()})})},[Fi.QUEST_ENROLLMENT_STATUS_UPDATE]:{payload:Ii.extend({evt:xn(Fi.QUEST_ENROLLMENT_STATUS_UPDATE),data:G({quest_id:H(),is_enrolled:W(),enrolled_at:H().date()})})}};function Vi(e,t){throw t}var Hi=G({}).nullable(),Ui=G({code:H()}),Wi=G({guilds:un(G({id:H(),name:H()}))}),Gi=G({id:H(),name:H(),icon_url:H().optional(),members:un(zr)}),Ki=G({id:H(),type:sr(Yr),guild_id:H().optional().nullable(),name:H().optional().nullable(),topic:H().optional().nullable(),bitrate:U().optional().nullable(),user_limit:U().optional().nullable(),position:U().optional().nullable(),voice_states:un(Ur),messages:un(pi)}),qi=G({channels:un(Xr)});Ki.nullable();var Ji=Ki.nullable(),Yi=Ki.nullable();G({input:yi,output:yi,mode:vi,automatic_gain_control:W(),echo_cancellation:W(),noise_suppression:W(),qos:W(),silence_warning:W(),deaf:W(),mute:W()});var Xi=G({evt:H()}),Zi=G({shortcut:gi}),Qi=Kr,$i=G({skus:un(Ci)}),ea=G({entitlements:un(Ti)}),ta=un(Ti).nullable(),na=G({use_interactive_pip:W()}),ra=G({locale:H()}),ia=G({enabled:W()}),aa=G({permissions:en().or(H())}),oa=cr(G({opened:W().or(an())}).default({opened:null})),sa=G({iosKeyboardResizesView:En(W())}),ca=Pr.extend({cmd:Cn(q),evt:an()});function la({cmd:e,data:t}){switch(e){case q.AUTHORIZE:return Ui.parse(t);case q.CAPTURE_SHORTCUT:return Zi.parse(t);case q.ENCOURAGE_HW_ACCELERATION:return ia.parse(t);case q.GET_CHANNEL:return Ki.parse(t);case q.GET_CHANNELS:return qi.parse(t);case q.GET_CHANNEL_PERMISSIONS:return aa.parse(t);case q.GET_GUILD:return Gi.parse(t);case q.GET_GUILDS:return Wi.parse(t);case q.GET_PLATFORM_BEHAVIORS:return sa.parse(t);case q.GET_CHANNEL:return Ki.parse(t);case q.SELECT_TEXT_CHANNEL:return Yi.parse(t);case q.SELECT_VOICE_CHANNEL:return Ji.parse(t);case q.SET_ACTIVITY:return Qi.parse(t);case q.GET_SKUS_EMBEDDED:return $i.parse(t);case q.GET_ENTITLEMENTS_EMBEDDED:return ea.parse(t);case q.SET_CONFIG:return na.parse(t);case q.START_PURCHASE:return ta.parse(t);case q.SUBSCRIBE:case q.UNSUBSCRIBE:return Xi.parse(t);case q.USER_SETTINGS_GET_LOCALE:return ra.parse(t);case q.OPEN_EXTERNAL_LINK:return oa.parse(t);case q.SET_ORIENTATION_LOCK_STATE:case q.SET_CERTIFIED_DEVICES:case q.SEND_ANALYTICS_EVENT:case q.OPEN_INVITE_DIALOG:case q.CAPTURE_LOG:case q.GET_SKUS:case q.GET_ENTITLEMENTS:return Hi.parse(t);case q.AUTHENTICATE:case q.GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS:case q.GET_QUEST:case q.GET_QUEST_ENROLLMENT_STATUS:case q.GET_RELATIONSHIPS:case q.GET_USER:case q.INITIATE_IMAGE_UPLOAD:case q.INVITE_USER_EMBEDDED:case q.OPEN_SHARE_MOMENT_DIALOG:case q.QUEST_START_TIMER:case q.REQUEST_PROXY_TICKET_REFRESH:case q.SHARE_INTERACTION:case q.SHARE_LINK:let{response:n}=jr[e];return n.parse(t);default:Vi(e,Error(`Unrecognized command ${e}`))}}function ua(e){return Object.assign(Object.assign({},e),{data:la(e)})}G({frame_id:H(),platform:Cn(or).optional().nullable()}),G({v:xn(1),encoding:xn(`json`).optional(),client_id:H(),frame_id:H()});var da=G({code:U(),message:H().optional()}),fa=G({evt:H().nullable(),nonce:H().nullable(),data:sn().nullable(),cmd:H()}).passthrough();function pa(e){let t=fa.parse(e);return t.evt==null?ua(ca.passthrough().parse(t)):t.evt===`ERROR`?Li.parse(t):zi(Ri.parse(t))}function ma(e,t,n,r=()=>void 0){let i=Pr.extend({cmd:xn(t),data:n});return async n=>{let a=await e({cmd:t,args:n,transfer:r(n)});return i.parse(a).data}}function ha(e,t=()=>void 0){let n=jr[e].response,r=Pr.extend({cmd:xn(e),data:n});return n=>async i=>{let a=await n({cmd:e,args:i,transfer:t(i)});return r.parse(a).data}}var ga=e=>ma(e,q.AUTHORIZE,Ui),_a=e=>ma(e,q.CAPTURE_LOG,Hi),va=e=>ma(e,q.ENCOURAGE_HW_ACCELERATION,ia),ya=e=>ma(e,q.GET_CHANNEL,Ki),ba=e=>ma(e,q.GET_ENTITLEMENTS_EMBEDDED,ea),xa=e=>ma(e,q.GET_SKUS_EMBEDDED,$i),Sa=e=>ma(e,q.GET_CHANNEL_PERMISSIONS,aa),Ca=e=>ma(e,q.GET_PLATFORM_BEHAVIORS,sa),wa=e=>ma(e,q.OPEN_EXTERNAL_LINK,oa),Ta=e=>ma(e,q.OPEN_INVITE_DIALOG,Hi);Kr.pick({state:!0,state_url:!0,details:!0,details_url:!0,timestamps:!0,assets:!0,party:!0,secrets:!0,instance:!0,type:!0}).extend({type:Kr.shape.type.optional(),instance:Kr.shape.instance.optional()}).nullable();var Ea=e=>ma(e,q.SET_ACTIVITY,Qi),Da=e=>ma(e,q.SET_CONFIG,na);function Oa({sendCommand:e,cmd:t,response:n,fallbackTransform:r,transferTransform:i=()=>void 0}){let a=Pr.extend({cmd:xn(t),data:n});return async n=>{try{let r=await e({cmd:t,args:n,transfer:i(n)});return a.parse(r).data}catch(o){if(o.code===ir.INVALID_PAYLOAD){let o=r(n),s=await e({cmd:t,args:o,transfer:i(o)});return a.parse(s).data}else throw o}}}var ka=e=>({lock_state:e.lock_state,picture_in_picture_lock_state:e.picture_in_picture_lock_state}),Aa=e=>Oa({sendCommand:e,cmd:q.SET_ORIENTATION_LOCK_STATE,response:Hi,fallbackTransform:ka}),ja=e=>ma(e,q.START_PURCHASE,ta),Ma=e=>ma(e,q.USER_SETTINGS_GET_LOCALE,ra),Na=ha(Or.AUTHENTICATE),Pa=ha(Or.GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS),Fa=ha(Or.GET_QUEST),Ia=ha(Or.GET_QUEST_ENROLLMENT_STATUS),La=ha(Or.GET_RELATIONSHIPS),Ra=ha(Or.GET_USER),za=ha(Or.INITIATE_IMAGE_UPLOAD),Ba=ha(Or.INVITE_USER_EMBEDDED),Va=ha(Or.OPEN_SHARE_MOMENT_DIALOG),Ha=ha(Or.QUEST_START_TIMER),Ua=ha(Or.REQUEST_PROXY_TICKET_REFRESH),Wa=ha(Or.SHARE_INTERACTION),Ga=ha(Or.SHARE_LINK);function Ka(e){return{authorize:ga(e),captureLog:_a(e),encourageHardwareAcceleration:va(e),getChannel:ya(e),getChannelPermissions:Sa(e),getEntitlements:ba(e),getPlatformBehaviors:Ca(e),getSkus:xa(e),openExternalLink:wa(e),openInviteDialog:Ta(e),setActivity:Ea(e),setConfig:Da(e),setOrientationLockState:Aa(e),startPurchase:ja(e),userSettingsGetLocale:Ma(e),getInstanceConnectedParticipants:Pa(e),authenticate:Na(e),getActivityInstanceConnectedParticipants:Pa(e),getQuest:Fa(e),getQuestEnrollmentStatus:Ia(e),getRelationships:La(e),getUser:Ra(e),initiateImageUpload:za(e),inviteUserEmbedded:Ba(e),openShareMomentDialog:Va(e),questStartTimer:Ha(e),requestProxyTicketRefresh:Ua(e),shareInteraction:Wa(e),shareLink:Ga(e)}}var qa=class extends Error{constructor(e,t=``){super(t),this.code=e,this.message=t,this.name=`Discord SDK Error`}};function Ja(){return{disableConsoleLogOverride:!1}}var Ya=[`log`,`warn`,`debug`,`info`,`error`];function Xa(e,t,n){let r=e[t],i=e;r&&(e[t]=function(){let e=[].slice.call(arguments);n(t,``+e.join(` `)),r.apply(i,e)})}var Za=`2.5.0`,Qa={randomUUID:typeof crypto<`u`&&crypto.randomUUID&&crypto.randomUUID.bind(crypto)},$a,eo=new Uint8Array(16);function to(){if(!$a){if(typeof crypto>`u`||!crypto.getRandomValues)throw Error(`crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported`);$a=crypto.getRandomValues.bind(crypto)}return $a(eo)}var no=[];for(let e=0;e<256;++e)no.push((e+256).toString(16).slice(1));function ro(e,t=0){return(no[e[t+0]]+no[e[t+1]]+no[e[t+2]]+no[e[t+3]]+`-`+no[e[t+4]]+no[e[t+5]]+`-`+no[e[t+6]]+no[e[t+7]]+`-`+no[e[t+8]]+no[e[t+9]]+`-`+no[e[t+10]]+no[e[t+11]]+no[e[t+12]]+no[e[t+13]]+no[e[t+14]]+no[e[t+15]]).toLowerCase()}function io(e,t,n){if(Qa.randomUUID&&!t&&!e)return Qa.randomUUID();e||={};let r=e.random??e.rng?.()??to();if(r.length<16)throw Error(`Random bytes length must be >= 16`);return r[6]=r[6]&15|64,r[8]=r[8]&63|128,ro(r)}var ao;(function(e){e[e.HANDSHAKE=0]=`HANDSHAKE`,e[e.FRAME=1]=`FRAME`,e[e.CLOSE=2]=`CLOSE`,e[e.HELLO=3]=`HELLO`})(ao||={});var oo=new Set(so());function so(){return typeof window>`u`?[]:[window.location.origin,`https://discord.com`,`https://discordapp.com`,`https://ptb.discord.com`,`https://ptb.discordapp.com`,`https://canary.discord.com`,`https://canary.discordapp.com`,`https://staging.discord.co`,`http://localhost:3333`,`https://pax.discord.com`,`null`]}function co(){return[window.parent.opener??window.parent,document.referrer?document.referrer:`*`]}var lo=class{getTransfer(e){switch(e.cmd){case q.SUBSCRIBE:case q.UNSUBSCRIBE:return;default:return e.transfer??void 0}}constructor(e,t){if(this.sdkVersion=Za,this.mobileAppVersion=null,this.source=null,this.sourceOrigin=``,this.eventBus=new be,this.pendingCommands=new Map,this.sendCommand=e=>{var t;if(this.source==null)throw Error(`Attempting to send message before initialization`);let n=io();return(t=this.source)==null||t.postMessage([ao.FRAME,Object.assign(Object.assign({},e),{nonce:n})],this.sourceOrigin,this.getTransfer(e)),new Promise((e,t)=>{this.pendingCommands.set(n,{resolve:e,reject:t})})},this.commands=Ka(this.sendCommand),this.handleMessage=e=>{if(!oo.has(e.origin))return;let t=e.data;if(!Array.isArray(t))return;let[n,r]=t;switch(n){case ao.HELLO:return;case ao.CLOSE:return this.handleClose(r);case ao.HANDSHAKE:return this.handleHandshake();case ao.FRAME:return this.handleFrame(r);default:throw Error(`Invalid message format`)}},this.isReady=!1,this.clientId=e,this.configuration=t??Ja(),typeof window<`u`&&window.addEventListener(`message`,this.handleMessage),typeof window>`u`){this.frameId=``,this.instanceId=``,this.customId=null,this.referrerId=null,this.platform=or.DESKTOP,this.guildId=null,this.channelId=null,this.locationId=null;return}let n=new URLSearchParams(this._getSearch()),r=n.get(`frame_id`);if(!r)throw Error(`frame_id query param is not defined`);this.frameId=r;let i=n.get(`instance_id`);if(!i)throw Error(`instance_id query param is not defined`);this.instanceId=i;let a=n.get(`platform`);if(!a)throw Error(`platform query param is not defined`);if(a!==or.DESKTOP&&a!==or.MOBILE)throw Error(`Invalid query param "platform" of "${a}". Valid values are "${or.DESKTOP}" or "${or.MOBILE}"`);this.platform=a,this.customId=n.get(`custom_id`),this.referrerId=n.get(`referrer_id`),this.guildId=n.get(`guild_id`),this.channelId=n.get(`channel_id`),this.locationId=n.get(`location_id`),this.mobileAppVersion=n.get(`mobile_app_version`),[this.source,this.sourceOrigin]=co(),this.addOnReadyListener(),this.handshake()}close(e,t){var n;window.removeEventListener(`message`,this.handleMessage);let r=io();(n=this.source)==null||n.postMessage([ao.CLOSE,{code:e,message:t,nonce:r}],this.sourceOrigin)}async subscribe(e,t,...n){let[r]=n,i=this.eventBus.listenerCount(e),a=this.eventBus.on(e,t);return Object.values(Fi).includes(e)&&e!==Fi.READY&&i===0&&await this.sendCommand({cmd:q.SUBSCRIBE,args:r,evt:e}),a}async unsubscribe(e,t,...n){let[r]=n;return e!==Fi.READY&&this.eventBus.listenerCount(e)===1&&await this.sendCommand({cmd:q.UNSUBSCRIBE,evt:e,args:r}),this.eventBus.off(e,t)}async ready(){this.isReady||await new Promise(e=>{this.eventBus.once(Fi.READY,e)})}parseMajorMobileVersion(){if(this.mobileAppVersion&&this.mobileAppVersion.includes(`.`))try{return parseInt(this.mobileAppVersion.split(`.`)[0])}catch{return-1}return-1}handshake(){var e;let t={v:1,encoding:`json`,client_id:this.clientId,frame_id:this.frameId},n=this.parseMajorMobileVersion();(this.platform===or.DESKTOP||n>=250)&&(t.sdk_version=this.sdkVersion),(e=this.source)==null||e.postMessage([ao.HANDSHAKE,t],this.sourceOrigin)}addOnReadyListener(){this.eventBus.once(Fi.READY,()=>{this.overrideConsoleLogging(),this.isReady=!0})}overrideConsoleLogging(){if(this.configuration.disableConsoleLogOverride)return;let e=(e,t)=>{this.commands.captureLog({level:e,message:t})};Ya.forEach(t=>{Xa(console,t,e)})}handleClose(e){da.parse(e)}handleHandshake(){}handleFrame(e){var t,n;let r;try{r=pa(e)}catch(t){console.error(`Failed to parse`,e),console.error(t);return}if(r.cmd===`DISPATCH`)this.eventBus.emit(r.evt,r.data);else{if(r.evt===`ERROR`){if(r.nonce!=null){(t=this.pendingCommands.get(r.nonce))==null||t.reject(r.data),this.pendingCommands.delete(r.nonce);return}this.eventBus.emit(`error`,new qa(r.data.code,r.data.message))}if(r.nonce==null){console.error(`Missing nonce`,e);return}(n=this.pendingCommands.get(r.nonce))==null||n.resolve(r),this.pendingCommands.delete(r.nonce)}}_getSearch(){return typeof window>`u`?``:window.location.search}},uo=1e9,fo={precision:20,rounding:4,toExpNeg:-7,toExpPos:21,LN10:`2.302585092994045684017991454684364207601101488628772976033327900967572609677352480235997205089598298341967784042286`},po=!0,mo=`[DecimalError] `,ho=mo+`Invalid argument: `,go=mo+`Exponent out of range: `,_o=Math.floor,vo=Math.pow,yo=/^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i,bo,xo=1e7,So=7,Co=9007199254740991,wo=_o(Co/So),J={};J.absoluteValue=J.abs=function(){var e=new this.constructor(this);return e.s&&=1,e},J.comparedTo=J.cmp=function(e){var t,n,r,i,a=this;if(e=new a.constructor(e),a.s!==e.s)return a.s||-e.s;if(a.e!==e.e)return a.e>e.e^a.s<0?1:-1;for(r=a.d.length,i=e.d.length,t=0,n=r<i?r:i;t<n;++t)if(a.d[t]!==e.d[t])return a.d[t]>e.d[t]^a.s<0?1:-1;return r===i?0:r>i^a.s<0?1:-1},J.decimalPlaces=J.dp=function(){var e=this,t=e.d.length-1,n=(t-e.e)*So;if(t=e.d[t],t)for(;t%10==0;t/=10)n--;return n<0?0:n},J.dividedBy=J.div=function(e){return Oo(this,new this.constructor(e))},J.dividedToIntegerBy=J.idiv=function(e){var t=this,n=t.constructor;return Fo(Oo(t,new n(e),0,1),n.precision)},J.equals=J.eq=function(e){return!this.cmp(e)},J.exponent=function(){return Ao(this)},J.greaterThan=J.gt=function(e){return this.cmp(e)>0},J.greaterThanOrEqualTo=J.gte=function(e){return this.cmp(e)>=0},J.isInteger=J.isint=function(){return this.e>this.d.length-2},J.isNegative=J.isneg=function(){return this.s<0},J.isPositive=J.ispos=function(){return this.s>0},J.isZero=function(){return this.s===0},J.lessThan=J.lt=function(e){return this.cmp(e)<0},J.lessThanOrEqualTo=J.lte=function(e){return this.cmp(e)<1},J.logarithm=J.log=function(e){var t,n=this,r=n.constructor,i=r.precision,a=i+5;if(e===void 0)e=new r(10);else if(e=new r(e),e.s<1||e.eq(bo))throw Error(mo+`NaN`);if(n.s<1)throw Error(mo+(n.s?`NaN`:`-Infinity`));return n.eq(bo)?new r(0):(po=!1,t=Oo(No(n,a),No(e,a),a),po=!0,Fo(t,i))},J.minus=J.sub=function(e){var t=this;return e=new t.constructor(e),t.s==e.s?Io(t,e):To(t,(e.s=-e.s,e))},J.modulo=J.mod=function(e){var t,n=this,r=n.constructor,i=r.precision;if(e=new r(e),!e.s)throw Error(mo+`NaN`);return n.s?(po=!1,t=Oo(n,e,0,1).times(e),po=!0,n.minus(t)):Fo(new r(n),i)},J.naturalExponential=J.exp=function(){return ko(this)},J.naturalLogarithm=J.ln=function(){return No(this)},J.negated=J.neg=function(){var e=new this.constructor(this);return e.s=-e.s||0,e},J.plus=J.add=function(e){var t=this;return e=new t.constructor(e),t.s==e.s?To(t,e):Io(t,(e.s=-e.s,e))},J.precision=J.sd=function(e){var t,n,r,i=this;if(e!==void 0&&e!==!!e&&e!==1&&e!==0)throw Error(ho+e);if(t=Ao(i)+1,r=i.d.length-1,n=r*So+1,r=i.d[r],r){for(;r%10==0;r/=10)n--;for(r=i.d[0];r>=10;r/=10)n++}return e&&t>n?t:n},J.squareRoot=J.sqrt=function(){var e,t,n,r,i,a,o,s=this,c=s.constructor;if(s.s<1){if(!s.s)return new c(0);throw Error(mo+`NaN`)}for(e=Ao(s),po=!1,i=Math.sqrt(+s),i==0||i==1/0?(t=Do(s.d),(t.length+e)%2==0&&(t+=`0`),i=Math.sqrt(t),e=_o((e+1)/2)-(e<0||e%2),i==1/0?t=`5e`+e:(t=i.toExponential(),t=t.slice(0,t.indexOf(`e`)+1)+e),r=new c(t)):r=new c(i.toString()),n=c.precision,i=o=n+3;;)if(a=r,r=a.plus(Oo(s,a,o+2)).times(.5),Do(a.d).slice(0,o)===(t=Do(r.d)).slice(0,o)){if(t=t.slice(o-3,o+1),i==o&&t==`4999`){if(Fo(a,n+1,0),a.times(a).eq(s)){r=a;break}}else if(t!=`9999`)break;o+=4}return po=!0,Fo(r,n)},J.times=J.mul=function(e){var t,n,r,i,a,o,s,c,l,u=this,d=u.constructor,f=u.d,p=(e=new d(e)).d;if(!u.s||!e.s)return new d(0);for(e.s*=u.s,n=u.e+e.e,c=f.length,l=p.length,c<l&&(a=f,f=p,p=a,o=c,c=l,l=o),a=[],o=c+l,r=o;r--;)a.push(0);for(r=l;--r>=0;){for(t=0,i=c+r;i>r;)s=a[i]+p[r]*f[i-r-1]+t,a[i--]=s%xo|0,t=s/xo|0;a[i]=(a[i]+t)%xo|0}for(;!a[--o];)a.pop();return t?++n:a.shift(),e.d=a,e.e=n,po?Fo(e,d.precision):e},J.toDecimalPlaces=J.todp=function(e,t){var n=this,r=n.constructor;return n=new r(n),e===void 0?n:(Eo(e,0,uo),t===void 0?t=r.rounding:Eo(t,0,8),Fo(n,e+Ao(n)+1,t))},J.toExponential=function(e,t){var n,r=this,i=r.constructor;return e===void 0?n=Lo(r,!0):(Eo(e,0,uo),t===void 0?t=i.rounding:Eo(t,0,8),r=Fo(new i(r),e+1,t),n=Lo(r,!0,e+1)),n},J.toFixed=function(e,t){var n,r,i=this,a=i.constructor;return e===void 0?Lo(i):(Eo(e,0,uo),t===void 0?t=a.rounding:Eo(t,0,8),r=Fo(new a(i),e+Ao(i)+1,t),n=Lo(r.abs(),!1,e+Ao(r)+1),i.isneg()&&!i.isZero()?`-`+n:n)},J.toInteger=J.toint=function(){var e=this,t=e.constructor;return Fo(new t(e),Ao(e)+1,t.rounding)},J.toNumber=function(){return+this},J.toPower=J.pow=function(e){var t,n,r,i,a,o,s=this,c=s.constructor,l=12,u=+(e=new c(e));if(!e.s)return new c(bo);if(s=new c(s),!s.s){if(e.s<1)throw Error(mo+`Infinity`);return s}if(s.eq(bo))return s;if(r=c.precision,e.eq(bo))return Fo(s,r);if(t=e.e,n=e.d.length-1,o=t>=n,a=s.s,!o){if(a<0)throw Error(mo+`NaN`)}else if((n=u<0?-u:u)<=Co){for(i=new c(bo),t=Math.ceil(r/So+4),po=!1;n%2&&(i=i.times(s),Ro(i.d,t)),n=_o(n/2),n!==0;)s=s.times(s),Ro(s.d,t);return po=!0,e.s<0?new c(bo).div(i):Fo(i,r)}return a=a<0&&e.d[Math.max(t,n)]&1?-1:1,s.s=1,po=!1,i=e.times(No(s,r+l)),po=!0,i=ko(i),i.s=a,i},J.toPrecision=function(e,t){var n,r,i=this,a=i.constructor;return e===void 0?(n=Ao(i),r=Lo(i,n<=a.toExpNeg||n>=a.toExpPos)):(Eo(e,1,uo),t===void 0?t=a.rounding:Eo(t,0,8),i=Fo(new a(i),e,t),n=Ao(i),r=Lo(i,e<=n||n<=a.toExpNeg,e)),r},J.toSignificantDigits=J.tosd=function(e,t){var n=this,r=n.constructor;return e===void 0?(e=r.precision,t=r.rounding):(Eo(e,1,uo),t===void 0?t=r.rounding:Eo(t,0,8)),Fo(new r(n),e,t)},J.toString=J.valueOf=J.val=J.toJSON=J[Symbol.for(`nodejs.util.inspect.custom`)]=function(){var e=this,t=Ao(e),n=e.constructor;return Lo(e,t<=n.toExpNeg||t>=n.toExpPos)};function To(e,t){var n,r,i,a,o,s,c,l,u=e.constructor,d=u.precision;if(!e.s||!t.s)return t.s||(t=new u(e)),po?Fo(t,d):t;if(c=e.d,l=t.d,o=e.e,i=t.e,c=c.slice(),a=o-i,a){for(a<0?(r=c,a=-a,s=l.length):(r=l,i=o,s=c.length),o=Math.ceil(d/So),s=o>s?o+1:s+1,a>s&&(a=s,r.length=1),r.reverse();a--;)r.push(0);r.reverse()}for(s=c.length,a=l.length,s-a<0&&(a=s,r=l,l=c,c=r),n=0;a;)n=(c[--a]=c[a]+l[a]+n)/xo|0,c[a]%=xo;for(n&&(c.unshift(n),++i),s=c.length;c[--s]==0;)c.pop();return t.d=c,t.e=i,po?Fo(t,d):t}function Eo(e,t,n){if(e!==~~e||e<t||e>n)throw Error(ho+e)}function Do(e){var t,n,r,i=e.length-1,a=``,o=e[0];if(i>0){for(a+=o,t=1;t<i;t++)r=e[t]+``,n=So-r.length,n&&(a+=Mo(n)),a+=r;o=e[t],r=o+``,n=So-r.length,n&&(a+=Mo(n))}else if(o===0)return`0`;for(;o%10==0;)o/=10;return a+o}var Oo=(function(){function e(e,t){var n,r=0,i=e.length;for(e=e.slice();i--;)n=e[i]*t+r,e[i]=n%xo|0,r=n/xo|0;return r&&e.unshift(r),e}function t(e,t,n,r){var i,a;if(n!=r)a=n>r?1:-1;else for(i=a=0;i<n;i++)if(e[i]!=t[i]){a=e[i]>t[i]?1:-1;break}return a}function n(e,t,n){for(var r=0;n--;)e[n]-=r,r=+(e[n]<t[n]),e[n]=r*xo+e[n]-t[n];for(;!e[0]&&e.length>1;)e.shift()}return function(r,i,a,o){var s,c,l,u,d,f,p,m,h,g,_,v,y,b,x,S,C,w,T=r.constructor,E=r.s==i.s?1:-1,D=r.d,O=i.d;if(!r.s)return new T(r);if(!i.s)throw Error(mo+`Division by zero`);for(c=r.e-i.e,C=O.length,x=D.length,p=new T(E),m=p.d=[],l=0;O[l]==(D[l]||0);)++l;if(O[l]>(D[l]||0)&&--c,v=a==null?a=T.precision:o?a+(Ao(r)-Ao(i))+1:a,v<0)return new T(0);if(v=v/So+2|0,l=0,C==1)for(u=0,O=O[0],v++;(l<x||u)&&v--;l++)y=u*xo+(D[l]||0),m[l]=y/O|0,u=y%O|0;else{for(u=xo/(O[0]+1)|0,u>1&&(O=e(O,u),D=e(D,u),C=O.length,x=D.length),b=C,h=D.slice(0,C),g=h.length;g<C;)h[g++]=0;w=O.slice(),w.unshift(0),S=O[0],O[1]>=xo/2&&++S;do u=0,s=t(O,h,C,g),s<0?(_=h[0],C!=g&&(_=_*xo+(h[1]||0)),u=_/S|0,u>1?(u>=xo&&(u=xo-1),d=e(O,u),f=d.length,g=h.length,s=t(d,h,f,g),s==1&&(u--,n(d,C<f?w:O,f))):(u==0&&(s=u=1),d=O.slice()),f=d.length,f<g&&d.unshift(0),n(h,d,g),s==-1&&(g=h.length,s=t(O,h,C,g),s<1&&(u++,n(h,C<g?w:O,g))),g=h.length):s===0&&(u++,h=[0]),m[l++]=u,s&&h[0]?h[g++]=D[b]||0:(h=[D[b]],g=1);while((b++<x||h[0]!==void 0)&&v--)}return m[0]||m.shift(),p.e=c,Fo(p,o?a+Ao(p)+1:a)}})();function ko(e,t){var n,r,i,a,o,s,c=0,l=0,u=e.constructor,d=u.precision;if(Ao(e)>16)throw Error(go+Ao(e));if(!e.s)return new u(bo);for(t==null?(po=!1,s=d):s=t,o=new u(.03125);e.abs().gte(.1);)e=e.times(o),l+=5;for(r=Math.log(vo(2,l))/Math.LN10*2+5|0,s+=r,n=i=a=new u(bo),u.precision=s;;){if(i=Fo(i.times(e),s),n=n.times(++c),o=a.plus(Oo(i,n,s)),Do(o.d).slice(0,s)===Do(a.d).slice(0,s)){for(;l--;)a=Fo(a.times(a),s);return u.precision=d,t==null?(po=!0,Fo(a,d)):a}a=o}}function Ao(e){for(var t=e.e*So,n=e.d[0];n>=10;n/=10)t++;return t}function jo(e,t,n){if(t>e.LN10.sd())throw po=!0,n&&(e.precision=n),Error(mo+`LN10 precision limit exceeded`);return Fo(new e(e.LN10),t)}function Mo(e){for(var t=``;e--;)t+=`0`;return t}function No(e,t){var n,r,i,a,o,s,c,l,u,d=1,f=10,p=e,m=p.d,h=p.constructor,g=h.precision;if(p.s<1)throw Error(mo+(p.s?`NaN`:`-Infinity`));if(p.eq(bo))return new h(0);if(t==null?(po=!1,l=g):l=t,p.eq(10))return t??(po=!0),jo(h,l);if(l+=f,h.precision=l,n=Do(m),r=n.charAt(0),a=Ao(p),Math.abs(a)<0x5543df729c000){for(;r<7&&r!=1||r==1&&n.charAt(1)>3;)p=p.times(e),n=Do(p.d),r=n.charAt(0),d++;a=Ao(p),r>1?(p=new h(`0.`+n),a++):p=new h(r+`.`+n.slice(1))}else return c=jo(h,l+2,g).times(a+``),p=No(new h(r+`.`+n.slice(1)),l-f).plus(c),h.precision=g,t==null?(po=!0,Fo(p,g)):p;for(s=o=p=Oo(p.minus(bo),p.plus(bo),l),u=Fo(p.times(p),l),i=3;;){if(o=Fo(o.times(u),l),c=s.plus(Oo(o,new h(i),l)),Do(c.d).slice(0,l)===Do(s.d).slice(0,l))return s=s.times(2),a!==0&&(s=s.plus(jo(h,l+2,g).times(a+``))),s=Oo(s,new h(d),l),h.precision=g,t==null?(po=!0,Fo(s,g)):s;s=c,i+=2}}function Po(e,t){var n,r,i;for((n=t.indexOf(`.`))>-1&&(t=t.replace(`.`,``)),(r=t.search(/e/i))>0?(n<0&&(n=r),n+=+t.slice(r+1),t=t.substring(0,r)):n<0&&(n=t.length),r=0;t.charCodeAt(r)===48;)++r;for(i=t.length;t.charCodeAt(i-1)===48;)--i;if(t=t.slice(r,i),t){if(i-=r,n=n-r-1,e.e=_o(n/So),e.d=[],r=(n+1)%So,n<0&&(r+=So),r<i){for(r&&e.d.push(+t.slice(0,r)),i-=So;r<i;)e.d.push(+t.slice(r,r+=So));t=t.slice(r),r=So-t.length}else r-=i;for(;r--;)t+=`0`;if(e.d.push(+t),po&&(e.e>wo||e.e<-wo))throw Error(go+n)}else e.s=0,e.e=0,e.d=[0];return e}function Fo(e,t,n){var r,i,a,o,s,c,l,u,d=e.d;for(o=1,a=d[0];a>=10;a/=10)o++;if(r=t-o,r<0)r+=So,i=t,l=d[u=0];else{if(u=Math.ceil((r+1)/So),a=d.length,u>=a)return e;for(l=a=d[u],o=1;a>=10;a/=10)o++;r%=So,i=r-So+o}if(n!==void 0&&(a=vo(10,o-i-1),s=l/a%10|0,c=t<0||d[u+1]!==void 0||l%a,c=n<4?(s||c)&&(n==0||n==(e.s<0?3:2)):s>5||s==5&&(n==4||c||n==6&&(r>0?i>0?l/vo(10,o-i):0:d[u-1])%10&1||n==(e.s<0?8:7))),t<1||!d[0])return c?(a=Ao(e),d.length=1,t=t-a-1,d[0]=vo(10,(So-t%So)%So),e.e=_o(-t/So)||0):(d.length=1,d[0]=e.e=e.s=0),e;if(r==0?(d.length=u,a=1,u--):(d.length=u+1,a=vo(10,So-r),d[u]=i>0?(l/vo(10,o-i)%vo(10,i)|0)*a:0),c)for(;;)if(u==0){(d[0]+=a)==xo&&(d[0]=1,++e.e);break}else{if(d[u]+=a,d[u]!=xo)break;d[u--]=0,a=1}for(r=d.length;d[--r]===0;)d.pop();if(po&&(e.e>wo||e.e<-wo))throw Error(go+Ao(e));return e}function Io(e,t){var n,r,i,a,o,s,c,l,u,d,f=e.constructor,p=f.precision;if(!e.s||!t.s)return t.s?t.s=-t.s:t=new f(e),po?Fo(t,p):t;if(c=e.d,d=t.d,r=t.e,l=e.e,c=c.slice(),o=l-r,o){for(u=o<0,u?(n=c,o=-o,s=d.length):(n=d,r=l,s=c.length),i=Math.max(Math.ceil(p/So),s)+2,o>i&&(o=i,n.length=1),n.reverse(),i=o;i--;)n.push(0);n.reverse()}else{for(i=c.length,s=d.length,u=i<s,u&&(s=i),i=0;i<s;i++)if(c[i]!=d[i]){u=c[i]<d[i];break}o=0}for(u&&(n=c,c=d,d=n,t.s=-t.s),s=c.length,i=d.length-s;i>0;--i)c[s++]=0;for(i=d.length;i>o;){if(c[--i]<d[i]){for(a=i;a&&c[--a]===0;)c[a]=xo-1;--c[a],c[i]+=xo}c[i]-=d[i]}for(;c[--s]===0;)c.pop();for(;c[0]===0;c.shift())--r;return c[0]?(t.d=c,t.e=r,po?Fo(t,p):t):new f(0)}function Lo(e,t,n){var r,i=Ao(e),a=Do(e.d),o=a.length;return t?(n&&(r=n-o)>0?a=a.charAt(0)+`.`+a.slice(1)+Mo(r):o>1&&(a=a.charAt(0)+`.`+a.slice(1)),a=a+(i<0?`e`:`e+`)+i):i<0?(a=`0.`+Mo(-i-1)+a,n&&(r=n-o)>0&&(a+=Mo(r))):i>=o?(a+=Mo(i+1-o),n&&(r=n-i-1)>0&&(a=a+`.`+Mo(r))):((r=i+1)<o&&(a=a.slice(0,r)+`.`+a.slice(r)),n&&(r=n-o)>0&&(i+1===o&&(a+=`.`),a+=Mo(r))),e.s<0?`-`+a:a}function Ro(e,t){if(e.length>t)return e.length=t,!0}function zo(e){var t,n,r;function i(e){var t=this;if(!(t instanceof i))return new i(e);if(t.constructor=i,e instanceof i){t.s=e.s,t.e=e.e,t.d=(e=e.d)?e.slice():e;return}if(typeof e==`number`){if(e*0!=0)throw Error(ho+e);if(e>0)t.s=1;else if(e<0)e=-e,t.s=-1;else{t.s=0,t.e=0,t.d=[0];return}if(e===~~e&&e<1e7){t.e=0,t.d=[e];return}return Po(t,e.toString())}else if(typeof e!=`string`)throw Error(ho+e);if(e.charCodeAt(0)===45?(e=e.slice(1),t.s=-1):t.s=1,yo.test(e))Po(t,e);else throw Error(ho+e)}if(i.prototype=J,i.ROUND_UP=0,i.ROUND_DOWN=1,i.ROUND_CEIL=2,i.ROUND_FLOOR=3,i.ROUND_HALF_UP=4,i.ROUND_HALF_DOWN=5,i.ROUND_HALF_EVEN=6,i.ROUND_HALF_CEIL=7,i.ROUND_HALF_FLOOR=8,i.clone=zo,i.config=i.set=Bo,e===void 0&&(e={}),e)for(r=[`precision`,`rounding`,`toExpNeg`,`toExpPos`,`LN10`],t=0;t<r.length;)e.hasOwnProperty(n=r[t++])||(e[n]=this[n]);return i.config(e),i}function Bo(e){if(!e||typeof e!=`object`)throw Error(mo+`Object expected`);var t,n,r,i=[`precision`,1,uo,`rounding`,0,8,`toExpNeg`,-1/0,0,`toExpPos`,0,1/0];for(t=0;t<i.length;t+=3)if((r=e[n=i[t]])!==void 0)if(_o(r)===r&&r>=i[t+1]&&r<=i[t+2])this[n]=r;else throw Error(ho+n+`: `+r);if((r=e[n=`LN10`])!==void 0)if(r==Math.LN10)this[n]=new this(r);else throw Error(ho+n+`: `+r);return this}bo=new(zo(fo))(1);var Y;(function(e){e.AED=`aed`,e.AFN=`afn`,e.ALL=`all`,e.AMD=`amd`,e.ANG=`ang`,e.AOA=`aoa`,e.ARS=`ars`,e.AUD=`aud`,e.AWG=`awg`,e.AZN=`azn`,e.BAM=`bam`,e.BBD=`bbd`,e.BDT=`bdt`,e.BGN=`bgn`,e.BHD=`bhd`,e.BIF=`bif`,e.BMD=`bmd`,e.BND=`bnd`,e.BOB=`bob`,e.BOV=`bov`,e.BRL=`brl`,e.BSD=`bsd`,e.BTN=`btn`,e.BWP=`bwp`,e.BYN=`byn`,e.BYR=`byr`,e.BZD=`bzd`,e.CAD=`cad`,e.CDF=`cdf`,e.CHE=`che`,e.CHF=`chf`,e.CHW=`chw`,e.CLF=`clf`,e.CLP=`clp`,e.CNY=`cny`,e.COP=`cop`,e.COU=`cou`,e.CRC=`crc`,e.CUC=`cuc`,e.CUP=`cup`,e.CVE=`cve`,e.CZK=`czk`,e.DJF=`djf`,e.DKK=`dkk`,e.DOP=`dop`,e.DZD=`dzd`,e.EGP=`egp`,e.ERN=`ern`,e.ETB=`etb`,e.EUR=`eur`,e.FJD=`fjd`,e.FKP=`fkp`,e.GBP=`gbp`,e.GEL=`gel`,e.GHS=`ghs`,e.GIP=`gip`,e.GMD=`gmd`,e.GNF=`gnf`,e.GTQ=`gtq`,e.GYD=`gyd`,e.HKD=`hkd`,e.HNL=`hnl`,e.HRK=`hrk`,e.HTG=`htg`,e.HUF=`huf`,e.IDR=`idr`,e.ILS=`ils`,e.INR=`inr`,e.IQD=`iqd`,e.IRR=`irr`,e.ISK=`isk`,e.JMD=`jmd`,e.JOD=`jod`,e.JPY=`jpy`,e.KES=`kes`,e.KGS=`kgs`,e.KHR=`khr`,e.KMF=`kmf`,e.KPW=`kpw`,e.KRW=`krw`,e.KWD=`kwd`,e.KYD=`kyd`,e.KZT=`kzt`,e.LAK=`lak`,e.LBP=`lbp`,e.LKR=`lkr`,e.LRD=`lrd`,e.LSL=`lsl`,e.LTL=`ltl`,e.LVL=`lvl`,e.LYD=`lyd`,e.MAD=`mad`,e.MDL=`mdl`,e.MGA=`mga`,e.MKD=`mkd`,e.MMK=`mmk`,e.MNT=`mnt`,e.MOP=`mop`,e.MRO=`mro`,e.MUR=`mur`,e.MVR=`mvr`,e.MWK=`mwk`,e.MXN=`mxn`,e.MXV=`mxv`,e.MYR=`myr`,e.MZN=`mzn`,e.NAD=`nad`,e.NGN=`ngn`,e.NIO=`nio`,e.NOK=`nok`,e.NPR=`npr`,e.NZD=`nzd`,e.OMR=`omr`,e.PAB=`pab`,e.PEN=`pen`,e.PGK=`pgk`,e.PHP=`php`,e.PKR=`pkr`,e.PLN=`pln`,e.PYG=`pyg`,e.QAR=`qar`,e.RON=`ron`,e.RSD=`rsd`,e.RUB=`rub`,e.RWF=`rwf`,e.SAR=`sar`,e.SBD=`sbd`,e.SCR=`scr`,e.SDG=`sdg`,e.SEK=`sek`,e.SGD=`sgd`,e.SHP=`shp`,e.SLL=`sll`,e.SOS=`sos`,e.SRD=`srd`,e.SSP=`ssp`,e.STD=`std`,e.SVC=`svc`,e.SYP=`syp`,e.SZL=`szl`,e.THB=`thb`,e.TJS=`tjs`,e.TMT=`tmt`,e.TND=`tnd`,e.TOP=`top`,e.TRY=`try`,e.TTD=`ttd`,e.TWD=`twd`,e.TZS=`tzs`,e.UAH=`uah`,e.UGX=`ugx`,e.USD=`usd`,e.USN=`usn`,e.USS=`uss`,e.UYI=`uyi`,e.UYU=`uyu`,e.UZS=`uzs`,e.VEF=`vef`,e.VND=`vnd`,e.VUV=`vuv`,e.WST=`wst`,e.XAF=`xaf`,e.XAG=`xag`,e.XAU=`xau`,e.XBA=`xba`,e.XBB=`xbb`,e.XBC=`xbc`,e.XBD=`xbd`,e.XCD=`xcd`,e.XDR=`xdr`,e.XFU=`xfu`,e.XOF=`xof`,e.XPD=`xpd`,e.XPF=`xpf`,e.XPT=`xpt`,e.XSU=`xsu`,e.XTS=`xts`,e.XUA=`xua`,e.YER=`yer`,e.ZAR=`zar`,e.ZMW=`zmw`,e.ZWL=`zwl`})(Y||={}),Y.AED,Y.AFN,Y.ALL,Y.AMD,Y.ANG,Y.AOA,Y.ARS,Y.AUD,Y.AWG,Y.AZN,Y.BAM,Y.BBD,Y.BDT,Y.BGN,Y.BHD,Y.BIF,Y.BMD,Y.BND,Y.BOB,Y.BOV,Y.BRL,Y.BSD,Y.BTN,Y.BWP,Y.BYR,Y.BYN,Y.BZD,Y.CAD,Y.CDF,Y.CHE,Y.CHF,Y.CHW,Y.CLF,Y.CLP,Y.CNY,Y.COP,Y.COU,Y.CRC,Y.CUC,Y.CUP,Y.CVE,Y.CZK,Y.DJF,Y.DKK,Y.DOP,Y.DZD,Y.EGP,Y.ERN,Y.ETB,Y.EUR,Y.FJD,Y.FKP,Y.GBP,Y.GEL,Y.GHS,Y.GIP,Y.GMD,Y.GNF,Y.GTQ,Y.GYD,Y.HKD,Y.HNL,Y.HRK,Y.HTG,Y.HUF,Y.IDR,Y.ILS,Y.INR,Y.IQD,Y.IRR,Y.ISK,Y.JMD,Y.JOD,Y.JPY,Y.KES,Y.KGS,Y.KHR,Y.KMF,Y.KPW,Y.KRW,Y.KWD,Y.KYD,Y.KZT,Y.LAK,Y.LBP,Y.LKR,Y.LRD,Y.LSL,Y.LTL,Y.LVL,Y.LYD,Y.MAD,Y.MDL,Y.MGA,Y.MKD,Y.MMK,Y.MNT,Y.MOP,Y.MRO,Y.MUR,Y.MVR,Y.MWK,Y.MXN,Y.MXV,Y.MYR,Y.MZN,Y.NAD,Y.NGN,Y.NIO,Y.NOK,Y.NPR,Y.NZD,Y.OMR,Y.PAB,Y.PEN,Y.PGK,Y.PHP,Y.PKR,Y.PLN,Y.PYG,Y.QAR,Y.RON,Y.RSD,Y.RUB,Y.RWF,Y.SAR,Y.SBD,Y.SCR,Y.SDG,Y.SEK,Y.SGD,Y.SHP,Y.SLL,Y.SOS,Y.SRD,Y.SSP,Y.STD,Y.SVC,Y.SYP,Y.SZL,Y.THB,Y.TJS,Y.TMT,Y.TND,Y.TOP,Y.TRY,Y.TTD,Y.TWD,Y.TZS,Y.UAH,Y.UGX,Y.USD,Y.USN,Y.USS,Y.UYI,Y.UYU,Y.UZS,Y.VEF,Y.VND,Y.VUV,Y.WST,Y.XAF,Y.XAG,Y.XAU,Y.XBA,Y.XBB,Y.XBC,Y.XBD,Y.XCD,Y.XDR,Y.XFU,Y.XOF,Y.XPD,Y.XPF,Y.XPT,Y.XSU,Y.XTS,Y.XUA,Y.YER,Y.ZAR,Y.ZMW,Y.ZWL;var Vo={exports:{}};Vo.exports;var Ho;function Uo(){return Ho?Vo.exports:(Ho=1,(function(e,t){var n=`__lodash_hash_undefined__`,r=9007199254740991,i=`[object Arguments]`,a=`[object Array]`,o=`[object Boolean]`,s=`[object Date]`,c=`[object Error]`,l=`[object Function]`,u=`[object Map]`,d=`[object Number]`,f=`[object Object]`,p=`[object Promise]`,m=`[object RegExp]`,h=`[object Set]`,g=`[object String]`,_=`[object Symbol]`,v=`[object WeakMap]`,y=`[object ArrayBuffer]`,b=`[object DataView]`,x=`[object Float32Array]`,S=`[object Float64Array]`,C=`[object Int8Array]`,w=`[object Int16Array]`,T=`[object Int32Array]`,E=`[object Uint8Array]`,D=`[object Uint8ClampedArray]`,O=`[object Uint16Array]`,ee=`[object Uint32Array]`,k=/\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/,te=/^\w*$/,ne=/^\./,A=/[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g,re=/[\\^$.*+?()[\]{}|]/g,ie=/\\(\\)?/g,ae=/^\[object .+?Constructor\]$/,oe=/^(?:0|[1-9]\d*)$/,j={};j[x]=j[S]=j[C]=j[w]=j[T]=j[E]=j[D]=j[O]=j[ee]=!0,j[i]=j[a]=j[y]=j[o]=j[b]=j[s]=j[c]=j[l]=j[u]=j[d]=j[f]=j[m]=j[h]=j[g]=j[v]=!1;var se=typeof he==`object`&&he&&he.Object===Object&&he,ce=typeof self==`object`&&self&&self.Object===Object&&self,le=se||ce||globalThis,M=t&&!t.nodeType&&t,ue=M&&e&&!e.nodeType&&e,de=ue&&ue.exports===M&&se.process,fe=function(){try{return de&&de.binding(`util`)}catch{}}(),pe=fe&&fe.isTypedArray;function me(e,t){for(var n=-1,r=e?e.length:0;++n<r&&t(e[n],n,e)!==!1;);return e}function ge(e,t){for(var n=-1,r=e?e.length:0;++n<r;)if(t(e[n],n,e))return!0;return!1}function _e(e){return function(t){return t?.[e]}}function ve(e,t){for(var n=-1,r=Array(e);++n<e;)r[n]=t(n);return r}function ye(e){return function(t){return e(t)}}function be(e,t){return e?.[t]}function N(e){var t=!1;if(e!=null&&typeof e.toString!=`function`)try{t=!!(e+``)}catch{}return t}function xe(e){var t=-1,n=Array(e.size);return e.forEach(function(e,r){n[++t]=[r,e]}),n}function P(e,t){return function(n){return e(t(n))}}function Se(e){var t=-1,n=Array(e.size);return e.forEach(function(e){n[++t]=e}),n}var F=Array.prototype,Ce=Function.prototype,we=Object.prototype,Te=le[`__core-js_shared__`],I=function(){var e=/[^.]+$/.exec(Te&&Te.keys&&Te.keys.IE_PROTO||``);return e?`Symbol(src)_1.`+e:``}(),Ee=Ce.toString,L=we.hasOwnProperty,De=we.toString,Oe=RegExp(`^`+Ee.call(L).replace(re,`\\$&`).replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g,`$1.*?`)+`$`),R=le.Symbol,ke=le.Uint8Array,z=P(Object.getPrototypeOf,Object),Ae=Object.create,je=we.propertyIsEnumerable,Me=F.splice,Ne=P(Object.keys,Object),Pe=Gt(le,`DataView`),Fe=Gt(le,`Map`),Ie=Gt(le,`Promise`),Le=Gt(le,`Set`),B=Gt(le,`WeakMap`),Re=Gt(Object,`create`),ze=W(Pe),Be=W(Fe),Ve=W(Ie),He=W(Le),V=W(B),Ue=R?R.prototype:void 0,We=Ue?Ue.valueOf:void 0,Ge=Ue?Ue.toString:void 0;function Ke(e){var t=-1,n=e?e.length:0;for(this.clear();++t<n;){var r=e[t];this.set(r[0],r[1])}}function qe(){this.__data__=Re?Re(null):{}}function Je(e){return this.has(e)&&delete this.__data__[e]}function Ye(e){var t=this.__data__;if(Re){var r=t[e];return r===n?void 0:r}return L.call(t,e)?t[e]:void 0}function Xe(e){var t=this.__data__;return Re?t[e]!==void 0:L.call(t,e)}function Ze(e,t){var r=this.__data__;return r[e]=Re&&t===void 0?n:t,this}Ke.prototype.clear=qe,Ke.prototype.delete=Je,Ke.prototype.get=Ye,Ke.prototype.has=Xe,Ke.prototype.set=Ze;function Qe(e){var t=-1,n=e?e.length:0;for(this.clear();++t<n;){var r=e[t];this.set(r[0],r[1])}}function $e(){this.__data__=[]}function et(e){var t=this.__data__,n=bt(t,e);return n<0?!1:(n==t.length-1?t.pop():Me.call(t,n,1),!0)}function tt(e){var t=this.__data__,n=bt(t,e);return n<0?void 0:t[n][1]}function nt(e){return bt(this.__data__,e)>-1}function rt(e,t){var n=this.__data__,r=bt(n,e);return r<0?n.push([e,t]):n[r][1]=t,this}Qe.prototype.clear=$e,Qe.prototype.delete=et,Qe.prototype.get=tt,Qe.prototype.has=nt,Qe.prototype.set=rt;function it(e){var t=-1,n=e?e.length:0;for(this.clear();++t<n;){var r=e[t];this.set(r[0],r[1])}}function at(){this.__data__={hash:new Ke,map:new(Fe||Qe),string:new Ke}}function ot(e){return Ut(this,e).delete(e)}function st(e){return Ut(this,e).get(e)}function ct(e){return Ut(this,e).has(e)}function lt(e,t){return Ut(this,e).set(e,t),this}it.prototype.clear=at,it.prototype.delete=ot,it.prototype.get=st,it.prototype.has=ct,it.prototype.set=lt;function ut(e){var t=-1,n=e?e.length:0;for(this.__data__=new it;++t<n;)this.add(e[t])}function dt(e){return this.__data__.set(e,n),this}function ft(e){return this.__data__.has(e)}ut.prototype.add=ut.prototype.push=dt,ut.prototype.has=ft;function pt(e){this.__data__=new Qe(e)}function mt(){this.__data__=new Qe}function ht(e){return this.__data__.delete(e)}function gt(e){return this.__data__.get(e)}function _t(e){return this.__data__.has(e)}function vt(e,t){var n=this.__data__;if(n instanceof Qe){var r=n.__data__;if(!Fe||r.length<199)return r.push([e,t]),this;n=this.__data__=new it(r)}return n.set(e,t),this}pt.prototype.clear=mt,pt.prototype.delete=ht,pt.prototype.get=gt,pt.prototype.has=_t,pt.prototype.set=vt;function yt(e,t){var n=an(e)||rn(e)?ve(e.length,String):[],r=n.length,i=!!r;for(var a in e)L.call(e,a)&&!(i&&(a==`length`||Jt(a,r)))&&n.push(a);return n}function bt(e,t){for(var n=e.length;n--;)if(nn(e[n][0],t))return n;return-1}function xt(e){return un(e)?Ae(e):{}}var St=zt();function Ct(e,t){return e&&St(e,t,gn)}function wt(e,t){t=Yt(t,e)?[t]:Rt(t);for(var n=0,r=t.length;e!=null&&n<r;)e=e[en(t[n++])];return n&&n==r?e:void 0}function Tt(e){return De.call(e)}function Et(e,t){return e!=null&&t in Object(e)}function Dt(e,t,n,r,i){return e===t?!0:e==null||t==null||!un(e)&&!G(t)?e!==e&&t!==t:Ot(e,t,Dt,n,r,i)}function Ot(e,t,n,r,o,s){var c=an(e),l=an(t),u=a,d=a;c||(u=Kt(e),u=u==i?f:u),l||(d=Kt(t),d=d==i?f:d);var p=u==f&&!N(e),m=d==f&&!N(t),h=u==d;if(h&&!p)return s||=new pt,c||fn(e)?Bt(e,t,n,r,o,s):Vt(e,t,u,n,r,o,s);if(!(o&2)){var g=p&&L.call(e,`__wrapped__`),_=m&&L.call(t,`__wrapped__`);if(g||_){var v=g?e.value():e,y=_?t.value():t;return s||=new pt,n(v,y,r,o,s)}}return h?(s||=new pt,Ht(e,t,n,r,o,s)):!1}function kt(e,t,n,r){var i=n.length,a=i;if(e==null)return!a;for(e=Object(e);i--;){var o=n[i];if(o[2]?o[1]!==e[o[0]]:!(o[0]in e))return!1}for(;++i<a;){o=n[i];var s=o[0],c=e[s],l=o[1];if(o[2]){if(c===void 0&&!(s in e))return!1}else{var u=new pt,d;if(!(d===void 0?Dt(l,c,r,3,u):d))return!1}}return!0}function At(e){return!un(e)||Zt(e)?!1:(cn(e)||N(e)?Oe:ae).test(W(e))}function jt(e){return G(e)&&ln(e.length)&&!!j[De.call(e)]}function Mt(e){return typeof e==`function`?e:e==null?vn:typeof e==`object`?an(e)?Ft(e[0],e[1]):Pt(e):yn(e)}function Nt(e){if(!Qt(e))return Ne(e);var t=[];for(var n in Object(e))L.call(e,n)&&n!=`constructor`&&t.push(n);return t}function Pt(e){var t=Wt(e);return t.length==1&&t[0][2]?U(t[0][0],t[0][1]):function(n){return n===e||kt(n,e,t)}}function Ft(e,t){return Yt(e)&&H(t)?U(en(e),t):function(n){var r=mn(n,e);return r===void 0&&r===t?hn(n,e):Dt(t,r,void 0,3)}}function It(e){return function(t){return wt(t,e)}}function Lt(e){if(typeof e==`string`)return e;if(dn(e))return Ge?Ge.call(e):``;var t=e+``;return t==`0`&&1/e==-1/0?`-0`:t}function Rt(e){return an(e)?e:$t(e)}function zt(e){return function(e,t,n){for(var r=-1,i=Object(e),a=n(e),o=a.length;o--;){var s=a[++r];if(t(i[s],s,i)===!1)break}return e}}function Bt(e,t,n,r,i,a){var o=i&2,s=e.length,c=t.length;if(s!=c&&!(o&&c>s))return!1;var l=a.get(e);if(l&&a.get(t))return l==t;var u=-1,d=!0,f=i&1?new ut:void 0;for(a.set(e,t),a.set(t,e);++u<s;){var p=e[u],m=t[u];if(r)var h=o?r(m,p,u,t,e,a):r(p,m,u,e,t,a);if(h!==void 0){if(h)continue;d=!1;break}if(f){if(!ge(t,function(e,t){if(!f.has(t)&&(p===e||n(p,e,r,i,a)))return f.add(t)})){d=!1;break}}else if(!(p===m||n(p,m,r,i,a))){d=!1;break}}return a.delete(e),a.delete(t),d}function Vt(e,t,n,r,i,a,l){switch(n){case b:if(e.byteLength!=t.byteLength||e.byteOffset!=t.byteOffset)return!1;e=e.buffer,t=t.buffer;case y:return!(e.byteLength!=t.byteLength||!r(new ke(e),new ke(t)));case o:case s:case d:return nn(+e,+t);case c:return e.name==t.name&&e.message==t.message;case m:case g:return e==t+``;case u:var f=xe;case h:var p=a&2;if(f||=Se,e.size!=t.size&&!p)return!1;var v=l.get(e);if(v)return v==t;a|=1,l.set(e,t);var x=Bt(f(e),f(t),r,i,a,l);return l.delete(e),x;case _:if(We)return We.call(e)==We.call(t)}return!1}function Ht(e,t,n,r,i,a){var o=i&2,s=gn(e),c=s.length;if(c!=gn(t).length&&!o)return!1;for(var l=c;l--;){var u=s[l];if(!(o?u in t:L.call(t,u)))return!1}var d=a.get(e);if(d&&a.get(t))return d==t;var f=!0;a.set(e,t),a.set(t,e);for(var p=o;++l<c;){u=s[l];var m=e[u],h=t[u];if(r)var g=o?r(h,m,u,t,e,a):r(m,h,u,e,t,a);if(!(g===void 0?m===h||n(m,h,r,i,a):g)){f=!1;break}p||=u==`constructor`}if(f&&!p){var _=e.constructor,v=t.constructor;_!=v&&`constructor`in e&&`constructor`in t&&!(typeof _==`function`&&_ instanceof _&&typeof v==`function`&&v instanceof v)&&(f=!1)}return a.delete(e),a.delete(t),f}function Ut(e,t){var n=e.__data__;return Xt(t)?n[typeof t==`string`?`string`:`hash`]:n.map}function Wt(e){for(var t=gn(e),n=t.length;n--;){var r=t[n],i=e[r];t[n]=[r,i,H(i)]}return t}function Gt(e,t){var n=be(e,t);return At(n)?n:void 0}var Kt=Tt;(Pe&&Kt(new Pe(new ArrayBuffer(1)))!=b||Fe&&Kt(new Fe)!=u||Ie&&Kt(Ie.resolve())!=p||Le&&Kt(new Le)!=h||B&&Kt(new B)!=v)&&(Kt=function(e){var t=De.call(e),n=t==f?e.constructor:void 0,r=n?W(n):void 0;if(r)switch(r){case ze:return b;case Be:return u;case Ve:return p;case He:return h;case V:return v}return t});function qt(e,t,n){t=Yt(t,e)?[t]:Rt(t);for(var r,i=-1,a=t.length;++i<a;){var o=en(t[i]);if(!(r=e!=null&&n(e,o)))break;e=e[o]}if(r)return r;var a=e?e.length:0;return!!a&&ln(a)&&Jt(o,a)&&(an(e)||rn(e))}function Jt(e,t){return t??=r,!!t&&(typeof e==`number`||oe.test(e))&&e>-1&&e%1==0&&e<t}function Yt(e,t){if(an(e))return!1;var n=typeof e;return n==`number`||n==`symbol`||n==`boolean`||e==null||dn(e)?!0:te.test(e)||!k.test(e)||t!=null&&e in Object(t)}function Xt(e){var t=typeof e;return t==`string`||t==`number`||t==`symbol`||t==`boolean`?e!==`__proto__`:e===null}function Zt(e){return!!I&&I in e}function Qt(e){var t=e&&e.constructor;return e===(typeof t==`function`&&t.prototype||we)}function H(e){return e===e&&!un(e)}function U(e,t){return function(n){return n!=null&&n[e]===t&&(t!==void 0||e in Object(n))}}var $t=tn(function(e){e=pn(e);var t=[];return ne.test(e)&&t.push(``),e.replace(A,function(e,n,r,i){t.push(r?i.replace(ie,`$1`):n||e)}),t});function en(e){if(typeof e==`string`||dn(e))return e;var t=e+``;return t==`0`&&1/e==-1/0?`-0`:t}function W(e){if(e!=null){try{return Ee.call(e)}catch{}try{return e+``}catch{}}return``}function tn(e,t){if(typeof e!=`function`||t&&typeof t!=`function`)throw TypeError(`Expected a function`);var n=function(){var r=arguments,i=t?t.apply(this,r):r[0],a=n.cache;if(a.has(i))return a.get(i);var o=e.apply(this,r);return n.cache=a.set(i,o),o};return n.cache=new(tn.Cache||it),n}tn.Cache=it;function nn(e,t){return e===t||e!==e&&t!==t}function rn(e){return sn(e)&&L.call(e,`callee`)&&(!je.call(e,`callee`)||De.call(e)==i)}var an=Array.isArray;function on(e){return e!=null&&ln(e.length)&&!cn(e)}function sn(e){return G(e)&&on(e)}function cn(e){var t=un(e)?De.call(e):``;return t==l||t==`[object GeneratorFunction]`}function ln(e){return typeof e==`number`&&e>-1&&e%1==0&&e<=r}function un(e){var t=typeof e;return!!e&&(t==`object`||t==`function`)}function G(e){return!!e&&typeof e==`object`}function dn(e){return typeof e==`symbol`||G(e)&&De.call(e)==_}var fn=pe?ye(pe):jt;function pn(e){return e==null?``:Lt(e)}function mn(e,t,n){var r=e==null?void 0:wt(e,t);return r===void 0?n:r}function hn(e,t){return e!=null&&qt(e,t,Et)}function gn(e){return on(e)?yt(e):Nt(e)}function _n(e,t,n){var r=an(e)||fn(e);if(t=Mt(t),n==null)if(r||un(e)){var i=e.constructor;n=r?an(e)?new i:[]:cn(i)?xt(z(e)):{}}else n={};return(r?me:Ct)(e,function(e,r,i){return t(n,e,r,i)}),n}function vn(e){return e}function yn(e){return Yt(e)?_e(en(e)):It(e)}e.exports=_n})(Vo,Vo.exports),Vo.exports)}Uo();var{Commands:Wo}=Mr,Go=[`identify`,`guilds.members.read`];function Ko(e,t){if(e instanceof M)return e;if(typeof e==`object`&&e&&`code`in e){let n=e.code,r=Object.values(ir).filter(e=>typeof e==`number`);if(typeof n==`number`&&r.includes(n))return new M(`${t}_${n}`)}return new M(t)}var qo=15e3,Jo=12e4,Yo=15e3;function Xo(e=window.location.search){let t=new URLSearchParams(e),n=t.getAll(`frame_id`),r=t.getAll(`platform`);if(n.length!==1||n[0]===void 0||n[0].length===0||n[0].length>255||r.length!==1||![`desktop`,`mobile`].includes(r[0]??``))throw new M(`invalid_launch`)}async function Zo(e,t,n,r,i){let a=null,o=new Promise((e,n)=>{t!==void 0&&(a=()=>n(new M(`cancelled`)),t.addEventListener(`abort`,a,{once:!0}),t.aborted&&a())}),s=null,c=new Promise((e,t)=>{s=setTimeout(()=>t(new M(r)),i)}),l=Promise.resolve().then(()=>{if(t?.aborted)throw new M(`cancelled`);return e()}).catch(e=>{throw Ko(e,n)});try{return await Promise.race([l,o,c])}finally{s!==null&&clearTimeout(s),t!==void 0&&a!==null&&t.removeEventListener(`abort`,a)}}function Qo(e,t){try{e.close(rr.CLOSE_NORMAL,t)}catch{}}async function $o(e,t=e=>new lo(e)){let n=de();Xo();let r=await fe(n,e),i;try{i=t(r.client_id)}catch(e){throw new M(Ko(e,`sdk_initialization_failed`).code,!0)}let a=()=>{if(e?.aborted)throw new M(`cancelled`)};try{if(a(),await Zo(()=>i.ready(),e,`sdk_ready_failed`,`sdk_ready_timeout`,qo),a(),i.instanceId!==n)throw new M(`instance_mismatch`);let t=await Zo(()=>i.commands.authorize({client_id:r.client_id,response_type:`code`,state:r.state,prompt:`none`,scope:[...Go]}),e,`authorize_failed`,`authorize_timeout`,Jo);a();let o=await pe(t.code,r.state,e);if(a(),await Zo(()=>i.commands.authenticate({access_token:o.access_token}),e,`sdk_authenticate_failed`,`sdk_authenticate_timeout`,Yo)==null)throw new M(`sdk_authenticate_failed`);a();let s=o.ticket,c=!1;return{sdk:i,bootstrap:r,player:o.player,takeTicket:()=>{let e=s;return s=null,e},destroy:()=>{c||(c=!0,s=null,Qo(i,`Hands session closed`))}}}catch(t){let n=e?.aborted?new M(`cancelled`):Ko(t,`authorization_failed`);throw n.code===`cancelled`||n.code===`instance_mismatch`||n.code.endsWith(`_timeout`)?(Qo(i,`Hands authorization closed`),n):new M(n.code,!0)}}var es={block:[55,.12,.22],hit:[85,.3,.42],counter_hit:[105,.38,.5],stun:[125,.42,.55],knockdown:[180,.62,.65]},ts=class{settings;constructor(e){this.settings=e}event(e){if(!this.settings().haptics)return;let t=es[e.kind];if(t===void 0||typeof navigator.getGamepads!=`function`)return;let n;try{n=[...navigator.getGamepads.call(navigator)]}catch{return}let r=n.find(e=>e!==null&&e.connected&&`vibrationActuator`in e)?.vibrationActuator;if(!(r==null||typeof r.playEffect!=`function`))try{Promise.resolve(r.playEffect(`dual-rumble`,{duration:Math.min(180,Math.max(0,t[0])),strongMagnitude:Math.min(.65,Math.max(0,t[1])),weakMagnitude:Math.min(.65,Math.max(0,t[2]))})).catch(()=>void 0)}catch{}}},ns={KeyF:[`left`,`jab`],KeyJ:[`right`,`jab`],KeyR:[`left`,`straight`],KeyU:[`right`,`straight`],KeyG:[`left`,`hook`],KeyH:[`right`,`hook`],KeyT:[`left`,`uppercut`],KeyY:[`right`,`uppercut`]},rs={KeyZ:{kind:`slip_left`},KeyX:{kind:`slip_right`},KeyC:{kind:`weave`},KeyV:{kind:`pull`},KeyB:{kind:`clinch`},KeyN:{kind:`switch_stance`},Digit1:{kind:`foul`,foul:`low_blow`},Digit2:{kind:`foul`,foul:`headbutt`},ArrowLeft:{kind:`get_up_left`},ArrowRight:{kind:`get_up_right`}},is=new Set([...Object.keys(ns),...Object.keys(rs),`KeyW`,`KeyA`,`KeyS`,`KeyD`,`KeyQ`,`KeyE`,`ShiftLeft`,`ShiftRight`,`AltLeft`,`AltRight`]),as=[`Move: W up · S down · A left · D right`,`High / low guard: Q / E`,`Left/right jab: F / J`,`Left/right straight: R / U`,`Left/right hook: G / H`,`Left/right uppercut: T / Y`,`Body: Shift · Power: Alt`,`Slip: Z / X · Weave: C · Pull: V`,`Clinch: B · Stance: N · Fouls: 1 / 2`,`Get-up rhythm: ← / →`,`Controller move: left stick. High / low guard: left / right shoulder (independent of punches).`,`Controller face classes: bottom jab · right straight · left hook · top uppercut.`,`Controller face hand: hold D-pad left for left hand or D-pad right for right hand, then press a face punch; otherwise punches use the right hand. A direction used for a punch is consumed and does not evade.`,`Controller modifiers: left trigger body · right trigger power.`,`Controller actions: left stick press clinch · right stick press switch stance · D-pad up weave · D-pad down pull · tap and release D-pad left/right to slip; while down, D-pad left/right performs the private get-up rhythm immediately.`,`Controller fouls: View/Back low blow · Menu/Start headbutt.`,`Right-stick gesture: horizontal 0–22.5° hook · 22.5–45° jab · 45–70° straight · 70–90° uppercut; left/right direction selects hand.`];function os(e,t){return e.kind===t.kind?e.kind===`punch`&&t.kind===`punch`?e.hand===t.hand&&e.class===t.class&&e.target===t.target&&e.power===t.power:e.kind===`foul`&&t.kind===`foul`?e.foul===t.foul:!0:!1}function ss(e,t,n){if(n<1||e.length>0&&os(e.at(-1),t))return;let r=e.length-n+1;r>0&&e.splice(0,r),e.push(t)}var cs=class{maximum;queue=[];constructor(e=1){this.maximum=e}push(e,t){if(this.maximum<1)return;let n=this.queue.at(-1);if(n!==void 0&&os(n.action,t)){n.source=e,n.action=t;return}let r=this.queue.length-this.maximum+1;r>0&&this.queue.splice(0,r),this.queue.push({action:t,source:e})}clear(){this.queue.length=0}clearSource(e){let t=this.queue.filter(t=>t.source!==e);this.queue.splice(0,this.queue.length,...t)}drain(e){return this.queue.splice(0,e).map(e=>e.action)}};function ls(e,t,n=.18){let r=Math.hypot(e,t);if(!Number.isFinite(r)||r<=n)return{x:0,y:0};let i=(Math.min(1,r)-n)/(1-n);return{x:e/r*i,y:t/r*i}}var us=(e,t)=>{let n=Math.atan2(Math.abs(t),Math.abs(e))*180/Math.PI;return n<22.5?`hook`:n<45?`jab`:n<70?`straight`:`uppercut`},ds=class{active=!1;hand=`right`;target=`head`;power=`normal`;peak={x:0,y:0};peakMagnitude=0;update(e,t,n,r){let i=Math.hypot(e,t);if(!this.active&&i>=.55&&Math.abs(e)>=.12)return this.active=!0,this.hand=e<0?`left`:`right`,this.target=n?`body`:`head`,this.power=r?`power`:`normal`,this.peak={x:e,y:t},this.peakMagnitude=i,null;if(!this.active)return null;if(i>this.peakMagnitude&&(this.peak={x:e,y:t},this.peakMagnitude=i),i<=.25){let e={kind:`punch`,hand:this.hand,class:us(this.peak.x,this.peak.y),target:this.target,power:this.power};return this.reset(),e}return null}reset(){this.active=!1,this.peak={x:0,y:0},this.peakMagnitude=0}},fs=[`jab`,`straight`,`hook`,`uppercut`],ps=(e,t)=>e.buttons[t]?.pressed===!0;function ms(){let e=navigator.getGamepads;if(typeof e!=`function`)return null;try{return[...e.call(navigator)].find(e=>e!==null&&e.connected&&e.mapping===`standard`)??null}catch{return null}}var hs=class{maximumQueue;sharedActions;gesture=new ds;queue=[];previous=new Set;selectorConsumed=new Map;raf=0;currentId=null;moveX=0;moveY=0;defense=`none`;knockdown=!1;enabled=!0;disconnect=e=>{e.gamepad.id===this.currentId&&this.reset()};constructor(e=1,t){this.maximumQueue=e,this.sharedActions=t,window.addEventListener(`gamepaddisconnected`,this.disconnect),this.raf=requestAnimationFrame(()=>this.poll())}push(e){this.sharedActions===void 0?ss(this.queue,e,this.maximumQueue):this.sharedActions.push(`gamepad`,e)}clearActions(){this.queue.length=0,this.sharedActions?.clear()}poll(){if(!this.enabled){this.reset(),this.schedulePoll();return}let e=ms();if(e===null){this.currentId!==null&&this.reset(),this.schedulePoll();return}this.currentId!==null&&this.currentId!==e.id&&this.reset(),this.currentId=e.id;let t=ls(e.axes[0]??0,e.axes[1]??0);this.moveX=Math.round(t.x*1e3),this.moveY=Math.round(-t.y*1e3);let n=ps(e,4)?`guard_high`:ps(e,5)?`guard_low`:`none`;n!==`none`&&n!==this.defense&&this.clearActions(),this.defense=n;let r=this.gesture.update(e.axes[2]??0,e.axes[3]??0,ps(e,6),ps(e,7));r!==null&&this.push(r);let i=fs.some((t,n)=>ps(e,n)&&!this.previous.has(n));for(let t of[14,15]){let n=ps(e,t),r=this.previous.has(t);this.knockdown?(n&&!r&&this.push({kind:t===14?`get_up_left`:`get_up_right`}),this.selectorConsumed.delete(t)):n?(r||this.selectorConsumed.set(t,!1),i&&this.selectorConsumed.set(t,!0)):r&&(this.selectorConsumed.get(t)===!1&&this.push({kind:t===14?`slip_left`:`slip_right`}),this.selectorConsumed.delete(t))}for(let t=0;t<e.buttons.length;t+=1){let n=ps(e,t),r=n&&!this.previous.has(t);if(n?this.previous.add(t):this.previous.delete(t),!r)continue;let i=fs[t];i===void 0?t===8?this.push({kind:`foul`,foul:`low_blow`}):t===9?this.push({kind:`foul`,foul:`headbutt`}):t===10?this.push({kind:`clinch`}):t===11?this.push({kind:`switch_stance`}):t===12?this.push({kind:`weave`}):t===13&&this.push({kind:`pull`}):this.push({kind:`punch`,hand:ps(e,14)?`left`:`right`,class:i,target:ps(e,6)?`body`:`head`,power:ps(e,7)?`power`:`normal`})}this.schedulePoll()}schedulePoll(){this.raf=requestAnimationFrame(()=>this.poll())}setKnockdown(e){this.knockdown=e}setEnabled(e){this.enabled=e,e||this.reset()}frame(e=4){let t=this.sharedActions===void 0?this.queue.splice(0,e):[];return{moveX:this.moveX,moveY:this.moveY,defense:this.defense,actions:t}}reset(){this.currentId=null,this.moveX=this.moveY=0,this.defense=`none`,this.queue.length=0,this.sharedActions?.clearSource(`gamepad`),this.previous.clear(),this.selectorConsumed.clear(),this.gesture.reset()}destroy(){cancelAnimationFrame(this.raf),window.removeEventListener(`gamepaddisconnected`,this.disconnect),this.reset()}},gs=class{target;maximumQueue;sharedActions;held=new Set;queue=[];enabled=!0;keydown=e=>{if(!this.enabled||!is.has(e.code)||(e.preventDefault(),e.repeat))return;this.held.add(e.code),(e.code===`KeyQ`||e.code===`KeyE`)&&this.clearActions();let t=ns[e.code];if(t!==void 0)this.push({kind:`punch`,hand:t[0],class:t[1],target:this.hasShift()?`body`:`head`,power:this.hasAlt()?`power`:`normal`});else{let t=rs[e.code];t!==void 0&&this.push(t)}};keyup=e=>{is.has(e.code)&&(this.enabled&&e.preventDefault(),this.held.delete(e.code))};visibility=()=>{document.hidden&&this.reset()};blur=()=>this.reset();constructor(e=window,t=1,n){this.target=e,this.maximumQueue=t,this.sharedActions=n,e.addEventListener(`keydown`,this.keydown),e.addEventListener(`keyup`,this.keyup),e.addEventListener(`blur`,this.blur),document.addEventListener(`visibilitychange`,this.visibility)}hasShift(){return this.held.has(`ShiftLeft`)||this.held.has(`ShiftRight`)}hasAlt(){return this.held.has(`AltLeft`)||this.held.has(`AltRight`)}push(e){this.sharedActions===void 0?ss(this.queue,e,this.maximumQueue):this.sharedActions.push(`keyboard`,e)}clearActions(){this.queue.length=0,this.sharedActions?.clear()}setEnabled(e){this.enabled=e,e||this.reset()}frame(e=4){let t=(this.held.has(`KeyD`)?1e3:0)-(this.held.has(`KeyA`)?1e3:0),n=(this.held.has(`KeyW`)?1e3:0)-(this.held.has(`KeyS`)?1e3:0);t!==0&&n!==0&&(t=Math.sign(t)*707,n=Math.sign(n)*707);let r=this.held.has(`KeyQ`)?`guard_high`:this.held.has(`KeyE`)?`guard_low`:`none`;return{moveX:t,moveY:n,defense:r,actions:this.sharedActions===void 0?this.queue.splice(0,e):[]}}reset(){this.held.clear(),this.queue.length=0,this.sharedActions?.clearSource(`keyboard`)}destroy(){this.reset(),this.target.removeEventListener(`keydown`,this.keydown),this.target.removeEventListener(`keyup`,this.keyup),this.target.removeEventListener(`blur`,this.blur),document.removeEventListener(`visibilitychange`,this.visibility)}},_s=class{actions=new cs(1);keyboard;gamepad;reset=()=>{this.keyboard.reset(),this.gamepad.reset(),this.actions.clear(),this.gamepad.setKnockdown(!1)};constructor(){this.keyboard=new gs(window,1,this.actions),this.gamepad=new hs(1,this.actions),window.addEventListener(`blur`,this.reset),document.addEventListener(`visibilitychange`,this.visibility)}visibility=()=>{document.hidden&&this.reset()};setActive(e){this.keyboard.setEnabled(e),this.gamepad.setEnabled(e)}setKnockdown(e){this.gamepad.setKnockdown(e)}frame(){let e=this.keyboard.frame(0),t=this.gamepad.frame(0);return{moveX:t.moveX===0?e.moveX:t.moveX,moveY:t.moveY===0?e.moveY:t.moveY,defense:t.defense===`none`?e.defense:t.defense,actions:this.actions.drain(4)}}destroy(){window.removeEventListener(`blur`,this.reset),document.removeEventListener(`visibilitychange`,this.visibility),this.keyboard.destroy(),this.gamepad.destroy()}},vs=(e,t,n)=>e+(t-e)*n,ys=(e,t,n)=>({...t,x:vs(e.x,t.x,n),y:vs(e.y,t.y,n),facing:vs(e.facing,t.facing,n),velocity_x:vs(e.velocity_x,t.velocity_x,n),velocity_y:vs(e.velocity_y,t.velocity_y,n),stamina:vs(e.stamina,t.stamina,n),maximum_stamina:vs(e.maximum_stamina,t.maximum_stamina,n),conditioning:vs(e.conditioning,t.conditioning,n),guard:vs(e.guard,t.guard,n),poise:vs(e.poise,t.poise,n)}),bs=class{maximum;snapshots=[];constructor(e=6){this.maximum=e}push(e){let t=this.snapshots.at(-1);return t!==void 0&&e.tick<=t.tick?!1:(this.snapshots.push(e),this.snapshots.length>this.maximum&&this.snapshots.shift(),!0)}latest(){return this.snapshots.at(-1)??null}sample(e){let t=this.snapshots.findIndex(t=>t.tick>=e);if(t<=0)return this.snapshots[Math.max(0,t)]??this.latest();let n=this.snapshots[t-1],r=this.snapshots[t];if(n.phase!==r.phase||n.fighters.some((e,t)=>e.knockdowns!==r.fighters[t]?.knockdowns))return r;let i=Math.max(0,Math.min(1,(e-n.tick)/Math.max(1,r.tick-n.tick)));return{...r,fighters:[ys(n.fighters[0],r.fighters[0],i),ys(n.fighters[1],r.fighters[1],i)]}}clear(){this.snapshots.length=0}},xs=class{highest=-1;accept(e){let t=new Set,n=e.filter(e=>e.event_id<=this.highest||t.has(e.event_id)?!1:(t.add(e.event_id),!0)).sort((e,t)=>e.event_id-t.event_id);for(let e of n)this.highest=Math.max(this.highest,e.event_id);return n}reset(){this.highest=-1}};function Ss(e=window.location){let t=new URL(`/api/hands/ws`,e.origin);if(e.protocol===`https:`)t.protocol=`wss:`;else if(e.protocol===`http:`&&[`localhost`,`127.0.0.1`,`::1`].includes(e.hostname))t.protocol=`ws:`;else throw Error(`insecure_websocket_origin`);return t.search=``,t.hash=``,t.toString()}var Cs=1,ws={moveX:0,moveY:0,defense:`none`,actions:[]},Ts=class{getInput;callbacks;makeSocket;now;socket=null;reconnectTicket;reconnectTimer=null;opponentPauseTimer=null;inputTimer=null;reconnectDeadline=0;opponentPauseDeadline=0;opponentPaused=!1;attempts=0;nextSequence=0;serverTick=0;role=null;active=!1;disposed=!1;terminal=!1;inputSuppressed=!1;listenersBound=!1;constructor(e,t,n,r=e=>new WebSocket(e),i=()=>performance.now()){this.getInput=t,this.callbacks=n,this.makeSocket=r,this.now=i,this.reconnectTicket=e}start(){this.disposed||this.listenersBound||(this.listenersBound=!0,window.addEventListener(`blur`,this.onInputLoss),window.addEventListener(`focus`,this.onInputRegain),document.addEventListener(`visibilitychange`,this.onVisibilityChange),this.connect(),!this.disposed&&!this.terminal&&(this.inputTimer=window.setInterval(()=>this.flushInput(),40)))}setActive(e){this.active=e}onInputLoss=()=>{this.inputSuppressed||=(this.sendInput(ws),!0)};onInputRegain=()=>{!document.hidden&&document.hasFocus()&&(this.inputSuppressed=!1)};onVisibilityChange=()=>{document.hidden?this.onInputLoss():this.onInputRegain()};connect(){if(this.disposed||this.terminal)return;let e=this.reconnectTicket;if(e===null){this.terminal=!0,this.stopInputLifecycle(),this.callbacks.onFreshAuth();return}let t;try{t=this.makeSocket(Ss())}catch{this.terminal=!0,this.stopInputLifecycle(),this.callbacks.onFatal(`network_unavailable`);return}this.socket=t,t.binaryType=`arraybuffer`,t.onopen=()=>{if(!(this.socket!==t||this.disposed))try{t.send(JSON.stringify({version:1,type:`authenticate`,ticket:e})),this.reconnectTicket=null}catch{this.handleClose(t)}},t.onmessage=e=>this.handleMessage(t,e),t.onerror=()=>void 0,t.onclose=()=>this.handleClose(t)}handleMessage(e,t){if(!(this.socket!==e||this.disposed||this.terminal))try{if(typeof t.data!=`string`&&!(t.data instanceof ArrayBuffer))throw Error(`unsupported_frame`);let n=oe(t.data);if(this.applyMessage(n),n.type===`ticket`){try{e.send(JSON.stringify({version:1,type:`ticket_ack`,refresh_id:n.refresh_id}))}catch{this.handleClose(e)}return}this.callbacks.onMessage(n),n.type===`error`?this.terminate(n.code,e):n.type===`final`&&(this.terminal=!0,this.clearTransportReconnect(!0),this.clearOpponentPause(!0),this.stopInputLifecycle(),this.socket===e&&(this.socket=null),e.onopen=e.onmessage=e.onclose=e.onerror=null,e.close(1e3,`complete`))}catch(e){this.callbacks.onFatal(me(e)),this.dispose()}}applyMessage(e){if(e.type===`welcome`){if(e.reconnect_ticket===void 0)throw Error(`missing_reconnect_ticket`);this.reconnectTicket=e.reconnect_ticket,this.serverTick=e.server_tick,this.role=e.role,e.role===`fighter`?this.nextSequence=Math.max(this.nextSequence,e.next_sequence):this.stopInputLifecycle(),this.attempts=0,this.clearTransportReconnect(!0)}else e.type===`ticket`?this.reconnectTicket=e.reconnect_ticket:e.type===`snapshot`?(this.serverTick=Math.max(this.serverTick,e.payload.tick),this.active=[`countdown`,`fight`,`knockdown`,`foul_recovery`].includes(e.payload.phase)):e.type===`paused`?(this.active=!1,this.startOpponentPause(e.grace_ms)):e.type===`resumed`?(this.active=!0,this.attempts=0,this.clearOpponentPause(!0)):e.type===`ready`?this.active=!0:e.type===`waiting`?this.active=!1:(e.type===`final`||e.type===`error`)&&(this.active=!1,this.clearOpponentPause(!0))}terminate(e,t){this.terminal=!0,this.active=!1,this.clearTransportReconnect(!0),this.clearOpponentPause(!0),this.stopInputLifecycle(),this.callbacks.onFatal(e),this.socket===t&&(this.socket=null,t.onopen=t.onmessage=t.onclose=t.onerror=null,t.close(1e3,`terminal`))}handleClose(e){if(this.socket!==e||(this.socket=null,this.active=!1,this.disposed||this.terminal))return;if(this.reconnectTicket===null){this.terminal=!0,this.stopInputLifecycle(),this.callbacks.onFreshAuth();return}this.clearOpponentPause(!1),this.reconnectDeadline===0&&(this.reconnectDeadline=this.now()+2e4);let t=Math.max(0,this.reconnectDeadline-this.now());if(this.callbacks.onReconnect(t),t<=0){this.terminal=!0,this.stopInputLifecycle(),this.callbacks.onFreshAuth();return}let n=Math.min(3e3,250*2**Math.min(this.attempts,4),t);this.attempts+=1,this.reconnectTimer=window.setTimeout(()=>{this.reconnectTimer=null,this.callbacks.onReconnect(Math.max(0,this.reconnectDeadline-this.now())),this.connect()},n)}sendInput(e){let t=this.socket;if(!(this.role!==`fighter`||!this.active||this.disposed||this.terminal||t?.readyState!==Cs))try{t.send(se(this.nextSequence,this.serverTick,{...e,actions:e.actions.slice(0,4)})),this.nextSequence+=1}catch{this.handleClose(t)}}flushInput(){this.inputSuppressed||document.hidden||!document.hasFocus()||this.sendInput(this.getInput())}startOpponentPause(e){this.clearOpponentPause(!1),this.opponentPaused=!0,this.opponentPauseDeadline=this.now()+e,this.callbacks.onReconnect(e),e>0&&this.scheduleOpponentPauseTick()}scheduleOpponentPauseTick(){let e=Math.max(0,this.opponentPauseDeadline-this.now());if(e<=0){this.opponentPauseDeadline=0,this.callbacks.onReconnect(0);return}this.opponentPauseTimer=window.setTimeout(()=>{this.opponentPauseTimer=null;let e=Math.max(0,this.opponentPauseDeadline-this.now());this.callbacks.onReconnect(e),e>0?this.scheduleOpponentPauseTick():this.opponentPauseDeadline=0},Math.min(250,e))}clearOpponentPause(e){let t=this.opponentPaused;this.opponentPaused=!1,this.opponentPauseDeadline=0,this.opponentPauseTimer!==null&&(clearTimeout(this.opponentPauseTimer),this.opponentPauseTimer=null),e&&t&&this.callbacks.onReconnect(0)}cancelReconnect(){this.reconnectTimer!==null&&(clearTimeout(this.reconnectTimer),this.reconnectTimer=null)}clearTransportReconnect(e){let t=this.reconnectDeadline!==0;this.reconnectDeadline=0,this.cancelReconnect(),e&&t&&this.callbacks.onReconnect(0)}stopInputLifecycle(){this.inputTimer!==null&&(clearInterval(this.inputTimer),this.inputTimer=null),this.listenersBound&&=(window.removeEventListener(`blur`,this.onInputLoss),window.removeEventListener(`focus`,this.onInputRegain),document.removeEventListener(`visibilitychange`,this.onVisibilityChange),!1)}dispose(){if(this.disposed)return;this.disposed=!0,this.active=!1,this.reconnectTicket=null,this.clearTransportReconnect(!0),this.clearOpponentPause(!0),this.stopInputLifecycle();let e=this.socket;this.socket=null,e!==null&&(e.onopen=e.onmessage=e.onclose=e.onerror=null,e.close(1e3,`teardown`))}},Es=1e3,Ds=1001,Os=1002,ks=1003,As=1004,js=1005,Ms=1006,Ns=1007,Ps=1008,Fs=1009,Is=1010,Ls=1011,Rs=1012,zs=1013,Bs=1014,Vs=1015,Hs=1016,Us=1017,Ws=1018,Gs=1020,Ks=35902,qs=35899,Js=1021,Ys=1022,Xs=1023,Zs=1026,Qs=1027,$s=1028,ec=1029,tc=1030,nc=1031,rc=1033,ic=33776,ac=33777,oc=33778,sc=33779,cc=35840,lc=35841,uc=35842,dc=35843,fc=36196,pc=37492,mc=37496,hc=37488,gc=37489,_c=37490,vc=37491,yc=37808,bc=37809,xc=37810,Sc=37811,Cc=37812,wc=37813,Tc=37814,Ec=37815,Dc=37816,Oc=37817,kc=37818,Ac=37819,jc=37820,Mc=37821,Nc=36492,Pc=36494,Fc=36495,Ic=36283,Lc=36284,Rc=36285,zc=36286,Bc=2300,Vc=2301,Hc=2302,Uc=2303,Wc=2400,Gc=2401,Kc=2402,qc=3200,Jc=`srgb`,Yc=`srgb-linear`,Xc=`linear`,Zc=`srgb`,Qc=7680,$c=35044,el=35048,tl=2e3;function nl(e){for(let t=e.length-1;t>=0;--t)if(e[t]>=65535)return!0;return!1}function rl(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}function il(e){return document.createElementNS(`http://www.w3.org/1999/xhtml`,e)}function al(){let e=il(`canvas`);return e.style.display=`block`,e}var ol={};function sl(...e){let t=`THREE.`+e.shift();console.log(t,...e)}function cl(e){let t=e[0];if(typeof t==`string`&&t.startsWith(`TSL:`)){let t=e[1];t&&t.isStackTrace?e[0]+=` `+t.getLocation():e[1]=`Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.`}return e}function X(...e){e=cl(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.warn(n.getError(t)):console.warn(t,...e)}}function ll(...e){e=cl(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.error(n.getError(t)):console.error(t,...e)}}function ul(...e){let t=e.join(` `);t in ol||(ol[t]=!0,X(...e))}function dl(e,t,n){return new Promise(function(r,i){function a(){switch(e.clientWaitSync(t,e.SYNC_FLUSH_COMMANDS_BIT,0)){case e.WAIT_FAILED:i();break;case e.TIMEOUT_EXPIRED:setTimeout(a,n);break;default:r()}}setTimeout(a,n)})}var fl={0:1,2:6,4:7,3:5,1:0,6:2,7:4,5:3},pl=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n!==void 0&&n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let r=n[e];if(r!==void 0){let e=r.indexOf(t);e!==-1&&r.splice(e,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let t=n.slice(0);for(let n=0,r=t.length;n<r;n++)t[n].call(this,e);e.target=null}}},ml=`00.01.02.03.04.05.06.07.08.09.0a.0b.0c.0d.0e.0f.10.11.12.13.14.15.16.17.18.19.1a.1b.1c.1d.1e.1f.20.21.22.23.24.25.26.27.28.29.2a.2b.2c.2d.2e.2f.30.31.32.33.34.35.36.37.38.39.3a.3b.3c.3d.3e.3f.40.41.42.43.44.45.46.47.48.49.4a.4b.4c.4d.4e.4f.50.51.52.53.54.55.56.57.58.59.5a.5b.5c.5d.5e.5f.60.61.62.63.64.65.66.67.68.69.6a.6b.6c.6d.6e.6f.70.71.72.73.74.75.76.77.78.79.7a.7b.7c.7d.7e.7f.80.81.82.83.84.85.86.87.88.89.8a.8b.8c.8d.8e.8f.90.91.92.93.94.95.96.97.98.99.9a.9b.9c.9d.9e.9f.a0.a1.a2.a3.a4.a5.a6.a7.a8.a9.aa.ab.ac.ad.ae.af.b0.b1.b2.b3.b4.b5.b6.b7.b8.b9.ba.bb.bc.bd.be.bf.c0.c1.c2.c3.c4.c5.c6.c7.c8.c9.ca.cb.cc.cd.ce.cf.d0.d1.d2.d3.d4.d5.d6.d7.d8.d9.da.db.dc.dd.de.df.e0.e1.e2.e3.e4.e5.e6.e7.e8.e9.ea.eb.ec.ed.ee.ef.f0.f1.f2.f3.f4.f5.f6.f7.f8.f9.fa.fb.fc.fd.fe.ff`.split(`.`),hl=1234567,gl=Math.PI/180,_l=180/Math.PI;function vl(){let e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0,r=Math.random()*4294967295|0;return(ml[e&255]+ml[e>>8&255]+ml[e>>16&255]+ml[e>>24&255]+`-`+ml[t&255]+ml[t>>8&255]+`-`+ml[t>>16&15|64]+ml[t>>24&255]+`-`+ml[n&63|128]+ml[n>>8&255]+`-`+ml[n>>16&255]+ml[n>>24&255]+ml[r&255]+ml[r>>8&255]+ml[r>>16&255]+ml[r>>24&255]).toLowerCase()}function yl(e,t,n){return Math.max(t,Math.min(n,e))}function bl(e,t){return(e%t+t)%t}function xl(e,t,n,r,i){return r+(e-t)*(i-r)/(n-t)}function Sl(e,t,n){return e===t?0:(n-e)/(t-e)}function Cl(e,t,n){return(1-n)*e+n*t}function wl(e,t,n,r){return Cl(e,t,1-Math.exp(-n*r))}function Tl(e,t=1){return t-Math.abs(bl(e,t*2)-t)}function El(e,t,n){return e<=t?0:e>=n?1:(e=(e-t)/(n-t),e*e*(3-2*e))}function Dl(e,t,n){return e<=t?0:e>=n?1:(e=(e-t)/(n-t),e*e*e*(e*(e*6-15)+10))}function Ol(e,t){return e+Math.floor(Math.random()*(t-e+1))}function kl(e,t){return e+Math.random()*(t-e)}function Al(e){return e*(.5-Math.random())}function jl(e){e!==void 0&&(hl=e);let t=hl+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function Ml(e){return e*gl}function Nl(e){return e*_l}function Pl(e){return(e&e-1)==0&&e!==0}function Fl(e){return 2**Math.ceil(Math.log(e)/Math.LN2)}function Il(e){return 2**Math.floor(Math.log(e)/Math.LN2)}function Ll(e,t,n,r,i){let a=Math.cos,o=Math.sin,s=a(n/2),c=o(n/2),l=a((t+r)/2),u=o((t+r)/2),d=a((t-r)/2),f=o((t-r)/2),p=a((r-t)/2),m=o((r-t)/2);switch(i){case`XYX`:e.set(s*u,c*d,c*f,s*l);break;case`YZY`:e.set(c*f,s*u,c*d,s*l);break;case`ZXZ`:e.set(c*d,c*f,s*u,s*l);break;case`XZX`:e.set(s*u,c*m,c*p,s*l);break;case`YXY`:e.set(c*p,s*u,c*m,s*l);break;case`ZYZ`:e.set(c*m,c*p,s*u,s*l);break;default:X(`MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: `+i)}}function Rl(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return e/4294967295;case Uint16Array:return e/65535;case Uint8Array:return e/255;case Int32Array:return Math.max(e/2147483647,-1);case Int16Array:return Math.max(e/32767,-1);case Int8Array:return Math.max(e/127,-1);default:throw Error(`THREE.MathUtils: Invalid component type.`)}}function zl(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return Math.round(e*4294967295);case Uint16Array:return Math.round(e*65535);case Uint8Array:return Math.round(e*255);case Int32Array:return Math.round(e*2147483647);case Int16Array:return Math.round(e*32767);case Int8Array:return Math.round(e*127);default:throw Error(`THREE.MathUtils: Invalid component type.`)}}var Bl={DEG2RAD:gl,RAD2DEG:_l,generateUUID:vl,clamp:yl,euclideanModulo:bl,mapLinear:xl,inverseLerp:Sl,lerp:Cl,damp:wl,pingpong:Tl,smoothstep:El,smootherstep:Dl,randInt:Ol,randFloat:kl,randFloatSpread:Al,seededRandom:jl,degToRad:Ml,radToDeg:Nl,isPowerOfTwo:Pl,ceilPowerOfTwo:Fl,floorPowerOfTwo:Il,setQuaternionFromProperEuler:Ll,normalize:zl,denormalize:Rl},Z=class e{static{e.prototype.isVector2=!0}constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw Error(`THREE.Vector2: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw Error(`THREE.Vector2: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6],this.y=r[1]*t+r[4]*n+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=yl(this.x,e.x,t.x),this.y=yl(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=yl(this.x,e,t),this.y=yl(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(yl(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(yl(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),r=Math.sin(t),i=this.x-e.x,a=this.y-e.y;return this.x=i*n-a*r+e.x,this.y=i*r+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Vl=class{constructor(e=0,t=0,n=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=r}static slerpFlat(e,t,n,r,i,a,o){let s=n[r+0],c=n[r+1],l=n[r+2],u=n[r+3],d=i[a+0],f=i[a+1],p=i[a+2],m=i[a+3];if(u!==m||s!==d||c!==f||l!==p){let e=s*d+c*f+l*p+u*m;e<0&&(d=-d,f=-f,p=-p,m=-m,e=-e);let t=1-o;if(e<.9995){let n=Math.acos(e),r=Math.sin(n);t=Math.sin(t*n)/r,o=Math.sin(o*n)/r,s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o}else{s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o;let e=1/Math.sqrt(s*s+c*c+l*l+u*u);s*=e,c*=e,l*=e,u*=e}}e[t]=s,e[t+1]=c,e[t+2]=l,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,r,i,a){let o=n[r],s=n[r+1],c=n[r+2],l=n[r+3],u=i[a],d=i[a+1],f=i[a+2],p=i[a+3];return e[t]=o*p+l*u+s*f-c*d,e[t+1]=s*p+l*d+c*u-o*f,e[t+2]=c*p+l*f+o*d-s*u,e[t+3]=l*p-o*u-s*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,r){return this._x=e,this._y=t,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,r=e._y,i=e._z,a=e._order,o=Math.cos,s=Math.sin,c=o(n/2),l=o(r/2),u=o(i/2),d=s(n/2),f=s(r/2),p=s(i/2);switch(a){case`XYZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`YXZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`ZXY`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`ZYX`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`YZX`:this._x=d*l*u+c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u-d*f*p;break;case`XZY`:this._x=d*l*u-c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u+d*f*p;break;default:X(`Quaternion: .setFromEuler() encountered an unknown order: `+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,r=Math.sin(n);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],r=t[4],i=t[8],a=t[1],o=t[5],s=t[9],c=t[2],l=t[6],u=t[10],d=n+o+u;if(d>0){let e=.5/Math.sqrt(d+1);this._w=.25/e,this._x=(l-s)*e,this._y=(i-c)*e,this._z=(a-r)*e}else if(n>o&&n>u){let e=2*Math.sqrt(1+n-o-u);this._w=(l-s)/e,this._x=.25*e,this._y=(r+a)/e,this._z=(i+c)/e}else if(o>u){let e=2*Math.sqrt(1+o-n-u);this._w=(i-c)/e,this._x=(r+a)/e,this._y=.25*e,this._z=(s+l)/e}else{let e=2*Math.sqrt(1+u-n-o);this._w=(a-r)/e,this._x=(i+c)/e,this._y=(s+l)/e,this._z=.25*e}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(yl(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let r=Math.min(1,t/n);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x*=e,this._y*=e,this._z*=e,this._w*=e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=t._x,s=t._y,c=t._z,l=t._w;return this._x=n*l+a*o+r*c-i*s,this._y=r*l+a*s+i*o-n*c,this._z=i*l+a*c+n*s-r*o,this._w=a*l-n*o-r*s-i*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,r=-r,i=-i,a=-a,o=-o);let s=1-t;if(o<.9995){let e=Math.acos(o),c=Math.sin(e);s=Math.sin(s*e)/c,t=Math.sin(t*e)/c,this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this._onChangeCallback()}else this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),i=Math.sqrt(n);return this.set(r*Math.sin(e),r*Math.cos(e),i*Math.sin(t),i*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},Q=class e{static{e.prototype.isVector3=!0}constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw Error(`THREE.Vector3: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw Error(`THREE.Vector3: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Ul.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Ul.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6]*r,this.y=i[1]*t+i[4]*n+i[7]*r,this.z=i[2]*t+i[5]*n+i[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=e.elements,a=1/(i[3]*t+i[7]*n+i[11]*r+i[15]);return this.x=(i[0]*t+i[4]*n+i[8]*r+i[12])*a,this.y=(i[1]*t+i[5]*n+i[9]*r+i[13])*a,this.z=(i[2]*t+i[6]*n+i[10]*r+i[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,r=this.z,i=e.x,a=e.y,o=e.z,s=e.w,c=2*(a*r-o*n),l=2*(o*t-i*r),u=2*(i*n-a*t);return this.x=t+s*c+a*u-o*l,this.y=n+s*l+o*c-i*u,this.z=r+s*u+i*l-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[4]*n+i[8]*r,this.y=i[1]*t+i[5]*n+i[9]*r,this.z=i[2]*t+i[6]*n+i[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=yl(this.x,e.x,t.x),this.y=yl(this.y,e.y,t.y),this.z=yl(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=yl(this.x,e,t),this.y=yl(this.y,e,t),this.z=yl(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(yl(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,r=e.y,i=e.z,a=t.x,o=t.y,s=t.z;return this.x=r*s-i*o,this.y=i*a-n*s,this.z=n*o-r*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return Hl.copy(this).projectOnVector(e),this.sub(Hl)}reflect(e){return this.sub(Hl.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(yl(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,r=this.z-e.z;return t*t+n*n+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let r=Math.sin(t)*e;return this.x=r*Math.sin(n),this.y=Math.cos(t)*e,this.z=r*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Hl=new Q,Ul=new Vl,Wl=class e{static{e.prototype.isMatrix3=!0}constructor(e,t,n,r,i,a,o,s,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c)}set(e,t,n,r,i,a,o,s,c){let l=this.elements;return l[0]=e,l[1]=r,l[2]=o,l[3]=t,l[4]=i,l[5]=s,l[6]=n,l[7]=a,l[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[3],s=n[6],c=n[1],l=n[4],u=n[7],d=n[2],f=n[5],p=n[8],m=r[0],h=r[3],g=r[6],_=r[1],v=r[4],y=r[7],b=r[2],x=r[5],S=r[8];return i[0]=a*m+o*_+s*b,i[3]=a*h+o*v+s*x,i[6]=a*g+o*y+s*S,i[1]=c*m+l*_+u*b,i[4]=c*h+l*v+u*x,i[7]=c*g+l*y+u*S,i[2]=d*m+f*_+p*b,i[5]=d*h+f*v+p*x,i[8]=d*g+f*y+p*S,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8];return t*a*l-t*o*c-n*i*l+n*o*s+r*i*c-r*a*s}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=l*a-o*c,d=o*s-l*i,f=c*i-a*s,p=t*u+n*d+r*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let m=1/p;return e[0]=u*m,e[1]=(r*c-l*n)*m,e[2]=(o*n-r*a)*m,e[3]=d*m,e[4]=(l*t-r*s)*m,e[5]=(r*i-o*t)*m,e[6]=f*m,e[7]=(n*s-c*t)*m,e[8]=(a*t-n*i)*m,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,r,i,a,o){let s=Math.cos(i),c=Math.sin(i);return this.set(n*s,n*c,-n*(s*a+c*o)+a+e,-r*c,r*s,-r*(-c*a+s*o)+o+t,0,0,1),this}scale(e,t){return ul(`Matrix3: .scale() is deprecated. Use .makeScale() instead.`),this.premultiply(Gl.makeScale(e,t)),this}rotate(e){return ul(`Matrix3: .rotate() is deprecated. Use .makeRotation() instead.`),this.premultiply(Gl.makeRotation(-e)),this}translate(e,t){return ul(`Matrix3: .translate() is deprecated. Use .makeTranslation() instead.`),this.premultiply(Gl.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<9;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},Gl=new Wl,Kl=new Wl().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),ql=new Wl().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Jl(){let e={enabled:!0,workingColorSpace:Yc,spaces:{},convert:function(e,t,n){return this.enabled===!1||t===n||!t||!n?e:(this.spaces[t].transfer===`srgb`&&(e.r=Xl(e.r),e.g=Xl(e.g),e.b=Xl(e.b)),this.spaces[t].primaries!==this.spaces[n].primaries&&(e.applyMatrix3(this.spaces[t].toXYZ),e.applyMatrix3(this.spaces[n].fromXYZ)),this.spaces[n].transfer===`srgb`&&(e.r=Zl(e.r),e.g=Zl(e.g),e.b=Zl(e.b)),e)},workingToColorSpace:function(e,t){return this.convert(e,this.workingColorSpace,t)},colorSpaceToWorking:function(e,t){return this.convert(e,t,this.workingColorSpace)},getPrimaries:function(e){return this.spaces[e].primaries},getTransfer:function(e){return e===``?Xc:this.spaces[e].transfer},getToneMappingMode:function(e){return this.spaces[e].outputColorSpaceConfig.toneMappingMode||`standard`},getLuminanceCoefficients:function(e,t=this.workingColorSpace){return e.fromArray(this.spaces[t].luminanceCoefficients)},define:function(e){Object.assign(this.spaces,e)},_getMatrix:function(e,t,n){return e.copy(this.spaces[t].toXYZ).multiply(this.spaces[n].fromXYZ)},_getDrawingBufferColorSpace:function(e){return this.spaces[e].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(e=this.workingColorSpace){return this.spaces[e].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(t,n){return ul(`ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace().`),e.workingToColorSpace(t,n)},toWorkingColorSpace:function(t,n){return ul(`ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking().`),e.colorSpaceToWorking(t,n)}},t=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],r=[.3127,.329];return e.define({[Yc]:{primaries:t,whitePoint:r,transfer:Xc,toXYZ:Kl,fromXYZ:ql,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:Jc},outputColorSpaceConfig:{drawingBufferColorSpace:Jc}},[Jc]:{primaries:t,whitePoint:r,transfer:Zc,toXYZ:Kl,fromXYZ:ql,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:Jc}}}),e}var Yl=Jl();function Xl(e){return e<.04045?e*.0773993808:(e*.9478672986+.0521327014)**2.4}function Zl(e){return e<.0031308?e*12.92:1.055*e**.41666-.055}var Ql,$l=class{static getDataURL(e,t=`image/png`){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>`u`)return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{Ql===void 0&&(Ql=il(`canvas`)),Ql.width=e.width,Ql.height=e.height;let t=Ql.getContext(`2d`);e instanceof ImageData?t.putImageData(e,0,0):t.drawImage(e,0,0,e.width,e.height),n=Ql}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap){let t=il(`canvas`);t.width=e.width,t.height=e.height;let n=t.getContext(`2d`);n.drawImage(e,0,0,e.width,e.height);let r=n.getImageData(0,0,e.width,e.height),i=r.data;for(let e=0;e<i.length;e++)i[e]=Xl(i[e]/255)*255;return n.putImageData(r,0,0),t}else if(e.data){let t=e.data.slice(0);for(let e=0;e<t.length;e++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[e]=Math.floor(Xl(t[e]/255)*255):t[e]=Xl(t[e]);return{data:t,width:e.width,height:e.height}}else return X(`ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied.`),e}},eu=0,tu=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:eu++}),this.uuid=vl(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<`u`&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<`u`&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t===null?e.set(0,0,0):e.set(t.width,t.height,t.depth||0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:``},r=this.data;if(r!==null){let e;if(Array.isArray(r)){e=[];for(let t=0,n=r.length;t<n;t++)r[t].isDataTexture?e.push(nu(r[t].image)):e.push(nu(r[t]))}else e=nu(r);n.url=e}return t||(e.images[this.uuid]=n),n}};function nu(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap?$l.getDataURL(e):e.data?{data:Array.from(e.data),width:e.width,height:e.height,type:e.data.constructor.name}:(X(`Texture: Unable to serialize Texture.`),{})}var ru=0,iu=new Q,au=class e extends pl{constructor(t=e.DEFAULT_IMAGE,n=e.DEFAULT_MAPPING,r=Ds,i=Ds,a=Ms,o=Ps,s=Xs,c=Fs,l=e.DEFAULT_ANISOTROPY,u=``){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:ru++}),this.uuid=vl(),this.name=``,this.source=new tu(t),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=r,this.wrapT=i,this.magFilter=a,this.minFilter=o,this.anisotropy=l,this.format=s,this.internalFormat=null,this.type=c,this.offset=new Z(0,0),this.repeat=new Z(1,1),this.center=new Z(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Wl,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(iu).x}get height(){return this.source.getSize(iu).y}get depth(){return this.source.getSize(iu).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){X(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){X(`Texture.setValues(): property '${t}' does not exist.`);continue}r&&n&&r.isVector2&&n.isVector2||r&&n&&r.isVector3&&n.isVector3||r&&n&&r.isMatrix3&&n.isMatrix3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:`Texture`,generator:`Texture.toJSON`},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:`dispose`})}transformUv(e){if(this.mapping!==300)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Es:e.x-=Math.floor(e.x);break;case Ds:e.x=e.x<0?0:1;break;case Os:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x-=Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Es:e.y-=Math.floor(e.y);break;case Ds:e.y=e.y<0?0:1;break;case Os:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y-=Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};au.DEFAULT_IMAGE=null,au.DEFAULT_MAPPING=300,au.DEFAULT_ANISOTROPY=1;var ou=class e{static{e.prototype.isVector4=!0}constructor(e=0,t=0,n=0,r=1){this.x=e,this.y=t,this.z=n,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,r){return this.x=e,this.y=t,this.z=n,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw Error(`THREE.Vector4: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw Error(`THREE.Vector4: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w===void 0?1:e.w,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*r+a[12]*i,this.y=a[1]*t+a[5]*n+a[9]*r+a[13]*i,this.z=a[2]*t+a[6]*n+a[10]*r+a[14]*i,this.w=a[3]*t+a[7]*n+a[11]*r+a[15]*i,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,r,i,a=.01,o=.1,s=e.elements,c=s[0],l=s[4],u=s[8],d=s[1],f=s[5],p=s[9],m=s[2],h=s[6],g=s[10];if(Math.abs(l-d)<a&&Math.abs(u-m)<a&&Math.abs(p-h)<a){if(Math.abs(l+d)<o&&Math.abs(u+m)<o&&Math.abs(p+h)<o&&Math.abs(c+f+g-3)<o)return this.set(1,0,0,0),this;t=Math.PI;let e=(c+1)/2,s=(f+1)/2,_=(g+1)/2,v=(l+d)/4,y=(u+m)/4,b=(p+h)/4;return e>s&&e>_?e<a?(n=0,r=.707106781,i=.707106781):(n=Math.sqrt(e),r=v/n,i=y/n):s>_?s<a?(n=.707106781,r=0,i=.707106781):(r=Math.sqrt(s),n=v/r,i=b/r):_<a?(n=.707106781,r=.707106781,i=0):(i=Math.sqrt(_),n=y/i,r=b/i),this.set(n,r,i,t),this}let _=Math.sqrt((h-p)*(h-p)+(u-m)*(u-m)+(d-l)*(d-l));return Math.abs(_)<.001&&(_=1),this.x=(h-p)/_,this.y=(u-m)/_,this.z=(d-l)/_,this.w=Math.acos((c+f+g-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=yl(this.x,e.x,t.x),this.y=yl(this.y,e.y,t.y),this.z=yl(this.z,e.z,t.z),this.w=yl(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=yl(this.x,e,t),this.y=yl(this.y,e,t),this.z=yl(this.z,e,t),this.w=yl(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(yl(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},su=class extends pl{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Ms,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new ou(0,0,e,t),this.scissorTest=!1,this.viewport=new ou(0,0,e,t),this.textures=[];let r=new au({width:e,height:t,depth:n.depth}),i=n.count;for(let e=0;e<i;e++)this.textures[e]=r.clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview,this.useArrayDepthTexture=n.useArrayDepthTexture}_setTextureOptions(e={}){let t={minFilter:Ms,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let e=0;e<this.textures.length;e++)this.textures[e].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let r=0,i=this.textures.length;r<i;r++)this.textures[r].image.width=e,this.textures[r].image.height=t,this.textures[r].image.depth=n,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let n=Object.assign({},e.textures[t].image);this.textures[t].source=new tu(n)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this.multiview=e.multiview,this.useArrayDepthTexture=e.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:`dispose`})}},cu=class extends su{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},lu=class extends au{constructor(e=null,t=1,n=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:r},this.magFilter=ks,this.minFilter=ks,this.wrapR=Ds,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}},uu=class extends au{constructor(e=null,t=1,n=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:r},this.magFilter=ks,this.minFilter=ks,this.wrapR=Ds,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},du=class e{static{e.prototype.isMatrix4=!0}constructor(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h)}set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){let g=this.elements;return g[0]=e,g[4]=t,g[8]=n,g[12]=r,g[1]=i,g[5]=a,g[9]=o,g[13]=s,g[2]=c,g[6]=l,g[10]=u,g[14]=d,g[3]=f,g[7]=p,g[11]=m,g[15]=h,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new e().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,r=1/fu.setFromMatrixColumn(e,0).length(),i=1/fu.setFromMatrixColumn(e,1).length(),a=1/fu.setFromMatrixColumn(e,2).length();return t[0]=n[0]*r,t[1]=n[1]*r,t[2]=n[2]*r,t[3]=0,t[4]=n[4]*i,t[5]=n[5]*i,t[6]=n[6]*i,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,r=e.y,i=e.z,a=Math.cos(n),o=Math.sin(n),s=Math.cos(r),c=Math.sin(r),l=Math.cos(i),u=Math.sin(i);if(e.order===`XYZ`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=-s*u,t[8]=c,t[1]=n+r*c,t[5]=e-i*c,t[9]=-o*s,t[2]=i-e*c,t[6]=r+n*c,t[10]=a*s}else if(e.order===`YXZ`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e+i*o,t[4]=r*o-n,t[8]=a*c,t[1]=a*u,t[5]=a*l,t[9]=-o,t[2]=n*o-r,t[6]=i+e*o,t[10]=a*s}else if(e.order===`ZXY`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e-i*o,t[4]=-a*u,t[8]=r+n*o,t[1]=n+r*o,t[5]=a*l,t[9]=i-e*o,t[2]=-a*c,t[6]=o,t[10]=a*s}else if(e.order===`ZYX`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=r*c-n,t[8]=e*c+i,t[1]=s*u,t[5]=i*c+e,t[9]=n*c-r,t[2]=-c,t[6]=o*s,t[10]=a*s}else if(e.order===`YZX`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=i-e*u,t[8]=r*u+n,t[1]=u,t[5]=a*l,t[9]=-o*l,t[2]=-c*l,t[6]=n*u+r,t[10]=e-i*u}else if(e.order===`XZY`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=-u,t[8]=c*l,t[1]=e*u+i,t[5]=a*l,t[9]=n*u-r,t[2]=r*u-n,t[6]=o*l,t[10]=i*u+e}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(mu,e,hu)}lookAt(e,t,n){let r=this.elements;return vu.subVectors(e,t),vu.lengthSq()===0&&(vu.z=1),vu.normalize(),gu.crossVectors(n,vu),gu.lengthSq()===0&&(Math.abs(n.z)===1?vu.x+=1e-4:vu.z+=1e-4,vu.normalize(),gu.crossVectors(n,vu)),gu.normalize(),_u.crossVectors(vu,gu),r[0]=gu.x,r[4]=_u.x,r[8]=vu.x,r[1]=gu.y,r[5]=_u.y,r[9]=vu.y,r[2]=gu.z,r[6]=_u.z,r[10]=vu.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[4],s=n[8],c=n[12],l=n[1],u=n[5],d=n[9],f=n[13],p=n[2],m=n[6],h=n[10],g=n[14],_=n[3],v=n[7],y=n[11],b=n[15],x=r[0],S=r[4],C=r[8],w=r[12],T=r[1],E=r[5],D=r[9],O=r[13],ee=r[2],k=r[6],te=r[10],ne=r[14],A=r[3],re=r[7],ie=r[11],ae=r[15];return i[0]=a*x+o*T+s*ee+c*A,i[4]=a*S+o*E+s*k+c*re,i[8]=a*C+o*D+s*te+c*ie,i[12]=a*w+o*O+s*ne+c*ae,i[1]=l*x+u*T+d*ee+f*A,i[5]=l*S+u*E+d*k+f*re,i[9]=l*C+u*D+d*te+f*ie,i[13]=l*w+u*O+d*ne+f*ae,i[2]=p*x+m*T+h*ee+g*A,i[6]=p*S+m*E+h*k+g*re,i[10]=p*C+m*D+h*te+g*ie,i[14]=p*w+m*O+h*ne+g*ae,i[3]=_*x+v*T+y*ee+b*A,i[7]=_*S+v*E+y*k+b*re,i[11]=_*C+v*D+y*te+b*ie,i[15]=_*w+v*O+y*ne+b*ae,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[12],a=e[1],o=e[5],s=e[9],c=e[13],l=e[2],u=e[6],d=e[10],f=e[14],p=e[3],m=e[7],h=e[11],g=e[15],_=s*f-c*d,v=o*f-c*u,y=o*d-s*u,b=a*f-c*l,x=a*d-s*l,S=a*u-o*l;return t*(m*_-h*v+g*y)-n*(p*_-h*b+g*x)+r*(p*v-m*b+g*S)-i*(p*y-m*x+h*S)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[1],a=e[5],o=e[9],s=e[2],c=e[6],l=e[10];return t*(a*l-o*c)-n*(i*l-o*s)+r*(i*c-a*s)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=e[9],d=e[10],f=e[11],p=e[12],m=e[13],h=e[14],g=e[15],_=t*o-n*a,v=t*s-r*a,y=t*c-i*a,b=n*s-r*o,x=n*c-i*o,S=r*c-i*s,C=l*m-u*p,w=l*h-d*p,T=l*g-f*p,E=u*h-d*m,D=u*g-f*m,O=d*g-f*h,ee=_*O-v*D+y*E+b*T-x*w+S*C;if(ee===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let k=1/ee;return e[0]=(o*O-s*D+c*E)*k,e[1]=(r*D-n*O-i*E)*k,e[2]=(m*S-h*x+g*b)*k,e[3]=(d*x-u*S-f*b)*k,e[4]=(s*T-a*O-c*w)*k,e[5]=(t*O-r*T+i*w)*k,e[6]=(h*y-p*S-g*v)*k,e[7]=(l*S-d*y+f*v)*k,e[8]=(a*D-o*T+c*C)*k,e[9]=(n*T-t*D-i*C)*k,e[10]=(p*x-m*y+g*_)*k,e[11]=(u*y-l*x-f*_)*k,e[12]=(o*w-a*E-s*C)*k,e[13]=(t*E-n*w+r*C)*k,e[14]=(m*v-p*b-h*_)*k,e[15]=(l*b-u*v+d*_)*k,this}scale(e){let t=this.elements,n=e.x,r=e.y,i=e.z;return t[0]*=n,t[4]*=r,t[8]*=i,t[1]*=n,t[5]*=r,t[9]*=i,t[2]*=n,t[6]*=r,t[10]*=i,t[3]*=n,t[7]*=r,t[11]*=i,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,r))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),r=Math.sin(t),i=1-n,a=e.x,o=e.y,s=e.z,c=i*a,l=i*o;return this.set(c*a+n,c*o-r*s,c*s+r*o,0,c*o+r*s,l*o+n,l*s-r*a,0,c*s-r*o,l*s+r*a,i*s*s+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,r,i,a){return this.set(1,n,i,0,e,1,a,0,t,r,1,0,0,0,0,1),this}compose(e,t,n){let r=this.elements,i=t._x,a=t._y,o=t._z,s=t._w,c=i+i,l=a+a,u=o+o,d=i*c,f=i*l,p=i*u,m=a*l,h=a*u,g=o*u,_=s*c,v=s*l,y=s*u,b=n.x,x=n.y,S=n.z;return r[0]=(1-(m+g))*b,r[1]=(f+y)*b,r[2]=(p-v)*b,r[3]=0,r[4]=(f-y)*x,r[5]=(1-(d+g))*x,r[6]=(h+_)*x,r[7]=0,r[8]=(p+v)*S,r[9]=(h-_)*S,r[10]=(1-(d+m))*S,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,n){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let i=this.determinantAffine();if(i===0)return n.set(1,1,1),t.identity(),this;let a=fu.set(r[0],r[1],r[2]).length(),o=fu.set(r[4],r[5],r[6]).length(),s=fu.set(r[8],r[9],r[10]).length();i<0&&(a=-a),pu.copy(this);let c=1/a,l=1/o,u=1/s;return pu.elements[0]*=c,pu.elements[1]*=c,pu.elements[2]*=c,pu.elements[4]*=l,pu.elements[5]*=l,pu.elements[6]*=l,pu.elements[8]*=u,pu.elements[9]*=u,pu.elements[10]*=u,t.setFromRotationMatrix(pu),n.x=a,n.y=o,n.z=s,this}makePerspective(e,t,n,r,i,a,o=tl,s=!1){let c=this.elements,l=2*i/(t-e),u=2*i/(n-r),d=(t+e)/(t-e),f=(n+r)/(n-r),p,m;if(s)p=i/(a-i),m=a*i/(a-i);else if(o===2e3)p=-(a+i)/(a-i),m=-2*a*i/(a-i);else if(o===2001)p=-a/(a-i),m=-a*i/(a-i);else throw Error(`THREE.Matrix4.makePerspective(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=u,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,r,i,a,o=tl,s=!1){let c=this.elements,l=2/(t-e),u=2/(n-r),d=-(t+e)/(t-e),f=-(n+r)/(n-r),p,m;if(s)p=1/(a-i),m=a/(a-i);else if(o===2e3)p=-2/(a-i),m=-(a+i)/(a-i);else if(o===2001)p=-1/(a-i),m=-i/(a-i);else throw Error(`THREE.Matrix4.makeOrthographic(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=0,c[12]=d,c[1]=0,c[5]=u,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<16;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},fu=new Q,pu=new du,mu=new Q(0,0,0),hu=new Q(1,1,1),gu=new Q,_u=new Q,vu=new Q,yu=new du,bu=new Vl,xu=class e{constructor(t=0,n=0,r=0,i=e.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=n,this._z=r,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,r=this._order){return this._x=e,this._y=t,this._z=n,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let r=e.elements,i=r[0],a=r[4],o=r[8],s=r[1],c=r[5],l=r[9],u=r[2],d=r[6],f=r[10];switch(t){case`XYZ`:this._y=Math.asin(yl(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-l,f),this._z=Math.atan2(-a,i)):(this._x=Math.atan2(d,c),this._z=0);break;case`YXZ`:this._x=Math.asin(-yl(l,-1,1)),Math.abs(l)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(s,c)):(this._y=Math.atan2(-u,i),this._z=0);break;case`ZXY`:this._x=Math.asin(yl(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(s,i));break;case`ZYX`:this._y=Math.asin(-yl(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(s,i)):(this._x=0,this._z=Math.atan2(-a,c));break;case`YZX`:this._z=Math.asin(yl(s,-1,1)),Math.abs(s)<.9999999?(this._x=Math.atan2(-l,c),this._y=Math.atan2(-u,i)):(this._x=0,this._y=Math.atan2(o,f));break;case`XZY`:this._z=Math.asin(-yl(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,i)):(this._x=Math.atan2(-l,f),this._y=0);break;default:X(`Euler: .setFromRotationMatrix() encountered an unknown order: `+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return yu.makeRotationFromQuaternion(e),this.setFromRotationMatrix(yu,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return bu.setFromEuler(this),this.setFromQuaternion(bu,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};xu.DEFAULT_ORDER=`XYZ`;var Su=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!=0}},Cu=0,wu=new Q,Tu=new Vl,Eu=new du,Du=new Q,Ou=new Q,ku=new Q,Au=new Vl,ju=new Q(1,0,0),Mu=new Q(0,1,0),Nu=new Q(0,0,1),Pu={type:`added`},Fu={type:`removed`},Iu={type:`childadded`,child:null},Lu={type:`childremoved`,child:null},Ru=class e extends pl{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Cu++}),this.uuid=vl(),this.name=``,this.type=`Object3D`,this.parent=null,this.children=[],this.up=e.DEFAULT_UP.clone();let t=new Q,n=new xu,r=new Vl,i=new Q(1,1,1);function a(){r.setFromEuler(n,!1)}function o(){n.setFromQuaternion(r,void 0,!1)}n._onChange(a),r._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:r},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new du},normalMatrix:{value:new Wl}}),this.matrix=new du,this.matrixWorld=new du,this.matrixAutoUpdate=e.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=e.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Su,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Tu.setFromAxisAngle(e,t),this.quaternion.multiply(Tu),this}rotateOnWorldAxis(e,t){return Tu.setFromAxisAngle(e,t),this.quaternion.premultiply(Tu),this}rotateX(e){return this.rotateOnAxis(ju,e)}rotateY(e){return this.rotateOnAxis(Mu,e)}rotateZ(e){return this.rotateOnAxis(Nu,e)}translateOnAxis(e,t){return wu.copy(e).applyQuaternion(this.quaternion),this.position.add(wu.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(ju,e)}translateY(e){return this.translateOnAxis(Mu,e)}translateZ(e){return this.translateOnAxis(Nu,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Eu.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Du.copy(e):Du.set(e,t,n);let r=this.parent;this.updateWorldMatrix(!0,!1),Ou.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Eu.lookAt(Ou,Du,this.up):Eu.lookAt(Du,Ou,this.up),this.quaternion.setFromRotationMatrix(Eu),r&&(Eu.extractRotation(r.matrixWorld),Tu.setFromRotationMatrix(Eu),this.quaternion.premultiply(Tu.invert()))}add(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return e===this?(ll(`Object3D.add: object can't be added as a child of itself.`,e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Pu),Iu.child=e,this.dispatchEvent(Iu),Iu.child=null):ll(`Object3D.add: object not an instance of THREE.Object3D.`,e),this)}remove(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.remove(arguments[e]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Fu),Lu.child=e,this.dispatchEvent(Lu),Lu.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Eu.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Eu.multiply(e.parent.matrixWorld)),e.applyMatrix4(Eu),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Pu),Iu.child=e,this.dispatchEvent(Iu),Iu.child=null,this}getObjectById(e){return this.getObjectByProperty(`id`,e)}getObjectByName(e){return this.getObjectByProperty(`name`,e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,r=this.children.length;n<r;n++){let r=this.children[n].getObjectByProperty(e,t);if(r!==void 0)return r}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let r=this.children;for(let i=0,a=r.length;i<a;i++)r[i].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ou,e,ku),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Ou,Au,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,r=e.z,i=this.matrix.elements;i[12]+=t-i[0]*t-i[4]*n-i[8]*r,i[13]+=n-i[1]*t-i[5]*n-i[9]*r,i[14]+=r-i[2]*t-i[6]*n-i[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t,n=!1){let r=this.parent;if(e===!0&&r!==null&&r.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),t===!0){let e=this.children;for(let t=0,r=e.length;t<r;t++)e[t].updateWorldMatrix(!1,!0,n)}}toJSON(e){let t=e===void 0||typeof e==`string`,n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:`Object`,generator:`Object3D.toJSON`});let r={};r.uuid=this.uuid,r.type=this.type,this.name!==``&&(r.name=this.name),this.castShadow===!0&&(r.castShadow=!0),this.receiveShadow===!0&&(r.receiveShadow=!0),this.visible===!1&&(r.visible=!1),this.frustumCulled===!1&&(r.frustumCulled=!1),this.renderOrder!==0&&(r.renderOrder=this.renderOrder),this.static!==!1&&(r.static=this.static),Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(r.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type=`InstancedMesh`,r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type=`BatchedMesh`,r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(e=>({...e,boundingBox:e.boundingBox?e.boundingBox.toJSON():void 0,boundingSphere:e.boundingSphere?e.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(e=>({...e})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function i(t,n){return t[n.uuid]===void 0&&(t[n.uuid]=n.toJSON(e)),n.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=i(e.geometries,this.geometry);let t=this.geometry.parameters;if(t!==void 0&&t.shapes!==void 0){let n=t.shapes;if(Array.isArray(n))for(let t=0,r=n.length;t<r;t++){let r=n[t];i(e.shapes,r)}else i(e.shapes,n)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(i(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let t=[];for(let n=0,r=this.material.length;n<r;n++)t.push(i(e.materials,this.material[n]));r.material=t}else r.material=i(e.materials,this.material);if(this.children.length>0){r.children=[];for(let t=0;t<this.children.length;t++)r.children.push(this.children[t].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let t=0;t<this.animations.length;t++){let n=this.animations[t];r.animations.push(i(e.animations,n))}}if(t){let t=a(e.geometries),r=a(e.materials),i=a(e.textures),o=a(e.images),s=a(e.shapes),c=a(e.skeletons),l=a(e.animations),u=a(e.nodes);t.length>0&&(n.geometries=t),r.length>0&&(n.materials=r),i.length>0&&(n.textures=i),o.length>0&&(n.images=o),s.length>0&&(n.shapes=s),c.length>0&&(n.skeletons=c),l.length>0&&(n.animations=l),u.length>0&&(n.nodes=u)}return n.object=r,n;function a(e){let t=[];for(let n in e){let r=e[n];delete r.metadata,t.push(r)}return t}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot===null?null:e.pivot.clone(),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let t=0;t<e.children.length;t++){let n=e.children[t];this.add(n.clone())}return this}};Ru.DEFAULT_UP=new Q(0,1,0),Ru.DEFAULT_MATRIX_AUTO_UPDATE=!0,Ru.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var zu=class extends Ru{constructor(){super(),this.isGroup=!0,this.type=`Group`}},Bu={type:`move`},Vu=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new zu,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new zu,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new Q,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new Q),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new zu,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new Q,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new Q,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:`connected`,data:e}),this}disconnect(e){return this.dispatchEvent({type:`disconnected`,data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let r=null,i=null,a=null,o=this._targetRay,s=this._grip,c=this._hand;if(e&&t.session.visibilityState!==`visible-blurred`){if(c&&e.hand){a=!0;for(let r of e.hand.values()){let e=t.getJointPose(r,n),i=this._getHandJoint(c,r);e!==null&&(i.matrix.fromArray(e.transform.matrix),i.matrix.decompose(i.position,i.rotation,i.scale),i.matrixWorldNeedsUpdate=!0,i.jointRadius=e.radius),i.visible=e!==null}let r=c.joints[`index-finger-tip`],i=c.joints[`thumb-tip`],o=r.position.distanceTo(i.position);c.inputState.pinching&&o>.025?(c.inputState.pinching=!1,this.dispatchEvent({type:`pinchend`,handedness:e.handedness,target:this})):!c.inputState.pinching&&o<=.015&&(c.inputState.pinching=!0,this.dispatchEvent({type:`pinchstart`,handedness:e.handedness,target:this}))}else s!==null&&e.gripSpace&&(i=t.getPose(e.gripSpace,n),i!==null&&(s.matrix.fromArray(i.transform.matrix),s.matrix.decompose(s.position,s.rotation,s.scale),s.matrixWorldNeedsUpdate=!0,i.linearVelocity?(s.hasLinearVelocity=!0,s.linearVelocity.copy(i.linearVelocity)):s.hasLinearVelocity=!1,i.angularVelocity?(s.hasAngularVelocity=!0,s.angularVelocity.copy(i.angularVelocity)):s.hasAngularVelocity=!1,s.eventsEnabled&&s.dispatchEvent({type:`gripUpdated`,data:e,target:this})));o!==null&&(r=t.getPose(e.targetRaySpace,n),r===null&&i!==null&&(r=i),r!==null&&(o.matrix.fromArray(r.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,r.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(r.linearVelocity)):o.hasLinearVelocity=!1,r.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(r.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(Bu)))}return o!==null&&(o.visible=r!==null),s!==null&&(s.visible=i!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new zu;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},Hu={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Uu={h:0,s:0,l:0},Wu={h:0,s:0,l:0};function Gu(e,t,n){return n<0&&(n+=1),n>1&&--n,n<1/6?e+(t-e)*6*n:n<1/2?t:n<2/3?e+(t-e)*6*(2/3-n):e}var Ku=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let t=e;t&&t.isColor?this.copy(t):typeof t==`number`?this.setHex(t):typeof t==`string`&&this.setStyle(t)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Jc){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Yl.colorSpaceToWorking(this,t),this}setRGB(e,t,n,r=Yl.workingColorSpace){return this.r=e,this.g=t,this.b=n,Yl.colorSpaceToWorking(this,r),this}setHSL(e,t,n,r=Yl.workingColorSpace){if(e=bl(e,1),t=yl(t,0,1),n=yl(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,i=2*n-r;this.r=Gu(i,r,e+1/3),this.g=Gu(i,r,e),this.b=Gu(i,r,e-1/3)}return Yl.colorSpaceToWorking(this,r),this}setStyle(e,t=Jc){function n(t){t!==void 0&&parseFloat(t)<1&&X(`Color: Alpha component of `+e+` will be ignored.`)}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let i,a=r[1],o=r[2];switch(a){case`rgb`:case`rgba`:if(i=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(255,parseInt(i[1],10))/255,Math.min(255,parseInt(i[2],10))/255,Math.min(255,parseInt(i[3],10))/255,t);if(i=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(100,parseInt(i[1],10))/100,Math.min(100,parseInt(i[2],10))/100,Math.min(100,parseInt(i[3],10))/100,t);break;case`hsl`:case`hsla`:if(i=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setHSL(parseFloat(i[1])/360,parseFloat(i[2])/100,parseFloat(i[3])/100,t);break;default:X(`Color: Unknown color model `+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let n=r[1],i=n.length;if(i===3)return this.setRGB(parseInt(n.charAt(0),16)/15,parseInt(n.charAt(1),16)/15,parseInt(n.charAt(2),16)/15,t);if(i===6)return this.setHex(parseInt(n,16),t);X(`Color: Invalid hex color `+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Jc){let n=Hu[e.toLowerCase()];return n===void 0?X(`Color: Unknown color `+e):this.setHex(n,t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Xl(e.r),this.g=Xl(e.g),this.b=Xl(e.b),this}copyLinearToSRGB(e){return this.r=Zl(e.r),this.g=Zl(e.g),this.b=Zl(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Jc){return Yl.workingToColorSpace(qu.copy(this),e),Math.round(yl(qu.r*255,0,255))*65536+Math.round(yl(qu.g*255,0,255))*256+Math.round(yl(qu.b*255,0,255))}getHexString(e=Jc){return(`000000`+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Yl.workingColorSpace){Yl.workingToColorSpace(qu.copy(this),t);let n=qu.r,r=qu.g,i=qu.b,a=Math.max(n,r,i),o=Math.min(n,r,i),s,c,l=(o+a)/2;if(o===a)s=0,c=0;else{let e=a-o;switch(c=l<=.5?e/(a+o):e/(2-a-o),a){case n:s=(r-i)/e+(r<i?6:0);break;case r:s=(i-n)/e+2;break;case i:s=(n-r)/e+4;break}s/=6}return e.h=s,e.s=c,e.l=l,e}getRGB(e,t=Yl.workingColorSpace){return Yl.workingToColorSpace(qu.copy(this),t),e.r=qu.r,e.g=qu.g,e.b=qu.b,e}getStyle(e=Jc){Yl.workingToColorSpace(qu.copy(this),e);let t=qu.r,n=qu.g,r=qu.b;return e===`srgb`?`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(r*255)})`:`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${r.toFixed(3)})`}offsetHSL(e,t,n){return this.getHSL(Uu),this.setHSL(Uu.h+e,Uu.s+t,Uu.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Uu),e.getHSL(Wu);let n=Cl(Uu.h,Wu.h,t),r=Cl(Uu.s,Wu.s,t),i=Cl(Uu.l,Wu.l,t);return this.setHSL(n,r,i),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,r=this.b,i=e.elements;return this.r=i[0]*t+i[3]*n+i[6]*r,this.g=i[1]*t+i[4]*n+i[7]*r,this.b=i[2]*t+i[5]*n+i[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},qu=new Ku;Ku.NAMES=Hu;var Ju=class e{constructor(e,t=25e-5){this.isFogExp2=!0,this.name=``,this.color=new Ku(e),this.density=t}clone(){return new e(this.color,this.density)}toJSON(){return{type:`FogExp2`,name:this.name,color:this.color.getHex(),density:this.density}}},Yu=class extends Ru{constructor(){super(),this.isScene=!0,this.type=`Scene`,this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new xu,this.environmentIntensity=1,this.environmentRotation=new xu,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}},Xu=new Q,Zu=new Q,Qu=new Q,$u=new Q,ed=new Q,td=new Q,nd=new Q,rd=new Q,id=new Q,ad=new Q,od=new ou,sd=new ou,cd=new ou,ld=class e{constructor(e=new Q,t=new Q,n=new Q){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,r){r.subVectors(n,t),Xu.subVectors(e,t),r.cross(Xu);let i=r.lengthSq();return i>0?r.multiplyScalar(1/Math.sqrt(i)):r.set(0,0,0)}static getBarycoord(e,t,n,r,i){Xu.subVectors(r,t),Zu.subVectors(n,t),Qu.subVectors(e,t);let a=Xu.dot(Xu),o=Xu.dot(Zu),s=Xu.dot(Qu),c=Zu.dot(Zu),l=Zu.dot(Qu),u=a*c-o*o;if(u===0)return i.set(0,0,0),null;let d=1/u,f=(c*s-o*l)*d,p=(a*l-o*s)*d;return i.set(1-f-p,p,f)}static containsPoint(e,t,n,r){return this.getBarycoord(e,t,n,r,$u)!==null&&$u.x>=0&&$u.y>=0&&$u.x+$u.y<=1}static getInterpolation(e,t,n,r,i,a,o,s){return this.getBarycoord(e,t,n,r,$u)===null?(s.x=0,s.y=0,`z`in s&&(s.z=0),`w`in s&&(s.w=0),null):(s.setScalar(0),s.addScaledVector(i,$u.x),s.addScaledVector(a,$u.y),s.addScaledVector(o,$u.z),s)}static getInterpolatedAttribute(e,t,n,r,i,a){return od.setScalar(0),sd.setScalar(0),cd.setScalar(0),od.fromBufferAttribute(e,t),sd.fromBufferAttribute(e,n),cd.fromBufferAttribute(e,r),a.setScalar(0),a.addScaledVector(od,i.x),a.addScaledVector(sd,i.y),a.addScaledVector(cd,i.z),a}static isFrontFacing(e,t,n,r){return Xu.subVectors(n,t),Zu.subVectors(e,t),Xu.cross(Zu).dot(r)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,r){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,t,n,r){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Xu.subVectors(this.c,this.b),Zu.subVectors(this.a,this.b),Xu.cross(Zu).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return e.getNormal(this.a,this.b,this.c,t)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,n){return e.getBarycoord(t,this.a,this.b,this.c,n)}getInterpolation(t,n,r,i,a){return e.getInterpolation(t,this.a,this.b,this.c,n,r,i,a)}containsPoint(t){return e.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return e.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,r=this.b,i=this.c,a,o;ed.subVectors(r,n),td.subVectors(i,n),rd.subVectors(e,n);let s=ed.dot(rd),c=td.dot(rd);if(s<=0&&c<=0)return t.copy(n);id.subVectors(e,r);let l=ed.dot(id),u=td.dot(id);if(l>=0&&u<=l)return t.copy(r);let d=s*u-l*c;if(d<=0&&s>=0&&l<=0)return a=s/(s-l),t.copy(n).addScaledVector(ed,a);ad.subVectors(e,i);let f=ed.dot(ad),p=td.dot(ad);if(p>=0&&f<=p)return t.copy(i);let m=f*c-s*p;if(m<=0&&c>=0&&p<=0)return o=c/(c-p),t.copy(n).addScaledVector(td,o);let h=l*p-f*u;if(h<=0&&u-l>=0&&f-p>=0)return nd.subVectors(i,r),o=(u-l)/(u-l+(f-p)),t.copy(r).addScaledVector(nd,o);let g=1/(h+m+d);return a=m*g,o=d*g,t.copy(n).addScaledVector(ed,a).addScaledVector(td,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},ud=class{constructor(e=new Q(1/0,1/0,1/0),t=new Q(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(fd.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(fd.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=fd.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute(`position`);if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let t=0,n=r.count;t<n;t++)e.isMesh===!0?e.getVertexPosition(t,fd):fd.fromBufferAttribute(r,t),fd.applyMatrix4(e.matrixWorld),this.expandByPoint(fd);else e.boundingBox===void 0?(n.boundingBox===null&&n.computeBoundingBox(),pd.copy(n.boundingBox)):(e.boundingBox===null&&e.computeBoundingBox(),pd.copy(e.boundingBox)),pd.applyMatrix4(e.matrixWorld),this.union(pd)}let r=e.children;for(let e=0,n=r.length;e<n;e++)this.expandByObject(r[e],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,fd),fd.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(bd),xd.subVectors(this.max,bd),md.subVectors(e.a,bd),hd.subVectors(e.b,bd),gd.subVectors(e.c,bd),_d.subVectors(hd,md),vd.subVectors(gd,hd),yd.subVectors(md,gd);let t=[0,-_d.z,_d.y,0,-vd.z,vd.y,0,-yd.z,yd.y,_d.z,0,-_d.x,vd.z,0,-vd.x,yd.z,0,-yd.x,-_d.y,_d.x,0,-vd.y,vd.x,0,-yd.y,yd.x,0];return!wd(t,md,hd,gd,xd)||(t=[1,0,0,0,1,0,0,0,1],!wd(t,md,hd,gd,xd))?!1:(Sd.crossVectors(_d,vd),t=[Sd.x,Sd.y,Sd.z],wd(t,md,hd,gd,xd))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,fd).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(fd).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(dd[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),dd[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),dd[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),dd[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),dd[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),dd[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),dd[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),dd[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(dd),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},dd=[new Q,new Q,new Q,new Q,new Q,new Q,new Q,new Q],fd=new Q,pd=new ud,md=new Q,hd=new Q,gd=new Q,_d=new Q,vd=new Q,yd=new Q,bd=new Q,xd=new Q,Sd=new Q,Cd=new Q;function wd(e,t,n,r,i){for(let a=0,o=e.length-3;a<=o;a+=3){Cd.fromArray(e,a);let o=i.x*Math.abs(Cd.x)+i.y*Math.abs(Cd.y)+i.z*Math.abs(Cd.z),s=t.dot(Cd),c=n.dot(Cd),l=r.dot(Cd);if(Math.max(-Math.max(s,c,l),Math.min(s,c,l))>o)return!1}return!0}var Td=new Q,Ed=new Z,Dd=0,Od=class extends pl{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw TypeError(`THREE.BufferAttribute: array should be a Typed Array.`);this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Dd++}),this.name=``,this.array=e,this.itemSize=t,this.count=e===void 0?0:e.length/t,this.normalized=n,this.usage=$c,this.updateRanges=[],this.gpuType=Vs,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let r=0,i=this.itemSize;r<i;r++)this.array[e+r]=t.array[n+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Ed.fromBufferAttribute(this,t),Ed.applyMatrix3(e),this.setXY(t,Ed.x,Ed.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)Td.fromBufferAttribute(this,t),Td.applyMatrix3(e),this.setXYZ(t,Td.x,Td.y,Td.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)Td.fromBufferAttribute(this,t),Td.applyMatrix4(e),this.setXYZ(t,Td.x,Td.y,Td.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Td.fromBufferAttribute(this,t),Td.applyNormalMatrix(e),this.setXYZ(t,Td.x,Td.y,Td.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Td.fromBufferAttribute(this,t),Td.transformDirection(e),this.setXYZ(t,Td.x,Td.y,Td.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Rl(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=zl(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Rl(t,this.array)),t}setX(e,t){return this.normalized&&(t=zl(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Rl(t,this.array)),t}setY(e,t){return this.normalized&&(t=zl(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Rl(t,this.array)),t}setZ(e,t){return this.normalized&&(t=zl(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Rl(t,this.array)),t}setW(e,t){return this.normalized&&(t=zl(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=zl(t,this.array),n=zl(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,r){return e*=this.itemSize,this.normalized&&(t=zl(t,this.array),n=zl(n,this.array),r=zl(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this}setXYZW(e,t,n,r,i){return e*=this.itemSize,this.normalized&&(t=zl(t,this.array),n=zl(n,this.array),r=zl(r,this.array),i=zl(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this.array[e+3]=i,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==``&&(e.name=this.name),this.usage!==35044&&(e.usage=this.usage),e}dispose(){this.dispatchEvent({type:`dispose`})}},kd=class extends Od{constructor(e,t,n){super(new Uint16Array(e),t,n)}},Ad=class extends Od{constructor(e,t,n){super(new Uint32Array(e),t,n)}},jd=class extends Od{constructor(e,t,n){super(new Float32Array(e),t,n)}},Md=new ud,Nd=new Q,Pd=new Q,Fd=class{constructor(e=new Q,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t===void 0?Md.setFromPoints(e).getCenter(n):n.copy(t);let r=0;for(let t=0,i=e.length;t<i;t++)r=Math.max(r,n.distanceToSquared(e[t]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius*=e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Nd.subVectors(e,this.center);let t=Nd.lengthSq();if(t>this.radius*this.radius){let e=Math.sqrt(t),n=(e-this.radius)*.5;this.center.addScaledVector(Nd,n/e),this.radius+=n}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Pd.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Nd.copy(e.center).add(Pd)),this.expandByPoint(Nd.copy(e.center).sub(Pd))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},Id=0,Ld=new du,Rd=new Ru,zd=new Q,Bd=new ud,Vd=new ud,Hd=new Q,Ud=class e extends pl{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Id++}),this.uuid=vl(),this.name=``,this.type=`BufferGeometry`,this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(nl(e)?Ad:kd)(e,1):this.index=e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let t=new Wl().getNormalMatrix(e);n.applyNormalMatrix(t),n.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(e){return Ld.makeRotationFromQuaternion(e),this.applyMatrix4(Ld),this}rotateX(e){return Ld.makeRotationX(e),this.applyMatrix4(Ld),this}rotateY(e){return Ld.makeRotationY(e),this.applyMatrix4(Ld),this}rotateZ(e){return Ld.makeRotationZ(e),this.applyMatrix4(Ld),this}translate(e,t,n){return Ld.makeTranslation(e,t,n),this.applyMatrix4(Ld),this}scale(e,t,n){return Ld.makeScale(e,t,n),this.applyMatrix4(Ld),this}lookAt(e){return Rd.lookAt(e),Rd.updateMatrix(),this.applyMatrix4(Rd.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(zd).negate(),this.translate(zd.x,zd.y,zd.z),this}setFromPoints(e){let t=this.getAttribute(`position`);if(t===void 0){let t=[];for(let n=0,r=e.length;n<r;n++){let r=e[n];t.push(r.x,r.y,r.z||0)}this.setAttribute(`position`,new jd(t,3))}else{let n=Math.min(e.length,t.count);for(let r=0;r<n;r++){let n=e[r];t.setXYZ(r,n.x,n.y,n.z||0)}e.length>t.count&&X(`BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry.`),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new ud);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){ll(`BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.`,this),this.boundingBox.set(new Q(-1/0,-1/0,-1/0),new Q(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let e=0,n=t.length;e<n;e++){let n=t[e];Bd.setFromBufferAttribute(n),this.morphTargetsRelative?(Hd.addVectors(this.boundingBox.min,Bd.min),this.boundingBox.expandByPoint(Hd),Hd.addVectors(this.boundingBox.max,Bd.max),this.boundingBox.expandByPoint(Hd)):(this.boundingBox.expandByPoint(Bd.min),this.boundingBox.expandByPoint(Bd.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&ll(`BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.`,this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Fd);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){ll(`BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.`,this),this.boundingSphere.set(new Q,1/0);return}if(e){let n=this.boundingSphere.center;if(Bd.setFromBufferAttribute(e),t)for(let e=0,n=t.length;e<n;e++){let n=t[e];Vd.setFromBufferAttribute(n),this.morphTargetsRelative?(Hd.addVectors(Bd.min,Vd.min),Bd.expandByPoint(Hd),Hd.addVectors(Bd.max,Vd.max),Bd.expandByPoint(Hd)):(Bd.expandByPoint(Vd.min),Bd.expandByPoint(Vd.max))}Bd.getCenter(n);let r=0;for(let t=0,i=e.count;t<i;t++)Hd.fromBufferAttribute(e,t),r=Math.max(r,n.distanceToSquared(Hd));if(t)for(let i=0,a=t.length;i<a;i++){let a=t[i],o=this.morphTargetsRelative;for(let t=0,i=a.count;t<i;t++)Hd.fromBufferAttribute(a,t),o&&(zd.fromBufferAttribute(e,t),Hd.add(zd)),r=Math.max(r,n.distanceToSquared(Hd))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&ll(`BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.`,this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){ll(`BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)`);return}let n=t.position,r=t.normal,i=t.uv,a=this.getAttribute(`tangent`);(a===void 0||a.count!==n.count)&&(a=new Od(new Float32Array(4*n.count),4),this.setAttribute(`tangent`,a));let o=[],s=[];for(let e=0;e<n.count;e++)o[e]=new Q,s[e]=new Q;let c=new Q,l=new Q,u=new Q,d=new Z,f=new Z,p=new Z,m=new Q,h=new Q;function g(e,t,r){c.fromBufferAttribute(n,e),l.fromBufferAttribute(n,t),u.fromBufferAttribute(n,r),d.fromBufferAttribute(i,e),f.fromBufferAttribute(i,t),p.fromBufferAttribute(i,r),l.sub(c),u.sub(c),f.sub(d),p.sub(d);let a=1/(f.x*p.y-p.x*f.y);isFinite(a)&&(m.copy(l).multiplyScalar(p.y).addScaledVector(u,-f.y).multiplyScalar(a),h.copy(u).multiplyScalar(f.x).addScaledVector(l,-p.x).multiplyScalar(a),o[e].add(m),o[t].add(m),o[r].add(m),s[e].add(h),s[t].add(h),s[r].add(h))}let _=this.groups;_.length===0&&(_=[{start:0,count:e.count}]);for(let t=0,n=_.length;t<n;++t){let n=_[t],r=n.start,i=n.count;for(let t=r,n=r+i;t<n;t+=3)g(e.getX(t+0),e.getX(t+1),e.getX(t+2))}let v=new Q,y=new Q,b=new Q,x=new Q;function S(e){b.fromBufferAttribute(r,e),x.copy(b);let t=o[e];v.copy(t),v.sub(b.multiplyScalar(b.dot(t))).normalize(),y.crossVectors(x,t);let n=y.dot(s[e])<0?-1:1;a.setXYZW(e,v.x,v.y,v.z,n)}for(let t=0,n=_.length;t<n;++t){let n=_[t],r=n.start,i=n.count;for(let t=r,n=r+i;t<n;t+=3)S(e.getX(t+0)),S(e.getX(t+1)),S(e.getX(t+2))}this._transformed=!0}computeVertexNormals(){let e=this.index,t=this.getAttribute(`position`);if(t!==void 0){let n=this.getAttribute(`normal`);if(n===void 0||n.count!==t.count)n=new Od(new Float32Array(t.count*3),3),this.setAttribute(`normal`,n);else for(let e=0,t=n.count;e<t;e++)n.setXYZ(e,0,0,0);let r=new Q,i=new Q,a=new Q,o=new Q,s=new Q,c=new Q,l=new Q,u=new Q;if(e)for(let d=0,f=e.count;d<f;d+=3){let f=e.getX(d+0),p=e.getX(d+1),m=e.getX(d+2);r.fromBufferAttribute(t,f),i.fromBufferAttribute(t,p),a.fromBufferAttribute(t,m),l.subVectors(a,i),u.subVectors(r,i),l.cross(u),o.fromBufferAttribute(n,f),s.fromBufferAttribute(n,p),c.fromBufferAttribute(n,m),o.add(l),s.add(l),c.add(l),n.setXYZ(f,o.x,o.y,o.z),n.setXYZ(p,s.x,s.y,s.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let e=0,o=t.count;e<o;e+=3)r.fromBufferAttribute(t,e+0),i.fromBufferAttribute(t,e+1),a.fromBufferAttribute(t,e+2),l.subVectors(a,i),u.subVectors(r,i),l.cross(u),n.setXYZ(e+0,l.x,l.y,l.z),n.setXYZ(e+1,l.x,l.y,l.z),n.setXYZ(e+2,l.x,l.y,l.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Hd.fromBufferAttribute(e,t),Hd.normalize(),e.setXYZ(t,Hd.x,Hd.y,Hd.z)}toNonIndexed(){function t(e,t){let n=e.array,r=e.itemSize,i=e.normalized,a=new n.constructor(t.length*r),o=0,s=0;for(let i=0,c=t.length;i<c;i++){o=e.isInterleavedBufferAttribute?t[i]*e.data.stride+e.offset:t[i]*r;for(let e=0;e<r;e++)a[s++]=n[o++]}return new Od(a,r,i)}if(this.index===null)return X(`BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.`),this;let n=new e,r=this.index.array,i=this.attributes;for(let e in i){let a=i[e],o=t(a,r);n.setAttribute(e,o)}let a=this.morphAttributes;for(let e in a){let i=[],o=a[e];for(let e=0,n=o.length;e<n;e++){let n=o[e],a=t(n,r);i.push(a)}n.morphAttributes[e]=i}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let e=0,t=o.length;e<t;e++){let t=o[e];n.addGroup(t.start,t.count,t.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:`BufferGeometry`,generator:`BufferGeometry.toJSON`}};if(e.uuid=this.uuid,e.type=this.parameters!==void 0&&this._transformed===!0?`BufferGeometry`:this.type,this.name!==``&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let t=this.parameters;for(let n in t)t[n]!==void 0&&(e[n]=t[n]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let t in n){let r=n[t];e.data.attributes[t]=r.toJSON(e.data)}let r={},i=!1;for(let t in this.morphAttributes){let n=this.morphAttributes[t],a=[];for(let t=0,r=n.length;t<r;t++){let r=n[t];a.push(r.toJSON(e.data))}a.length>0&&(r[t]=a,i=!0)}i&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let r=e.attributes;for(let e in r){let n=r[e];this.setAttribute(e,n.clone(t))}let i=e.morphAttributes;for(let e in i){let n=[],r=i[e];for(let e=0,i=r.length;e<i;e++)n.push(r[e].clone(t));this.morphAttributes[e]=n}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let e=0,t=a.length;e<t;e++){let t=a[e];this.addGroup(t.start,t.count,t.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let s=e.boundingSphere;return s!==null&&(this.boundingSphere=s.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this._transformed=e._transformed,this}dispose(){this.dispatchEvent({type:`dispose`})}},Wd=0,Gd=class extends pl{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Wd++}),this.uuid=vl(),this.name=``,this.type=`Material`,this.blending=1,this.side=0,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=204,this.blendDst=205,this.blendEquation=100,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ku(0,0,0),this.blendAlpha=0,this.depthFunc=3,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=519,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Qc,this.stencilZFail=Qc,this.stencilZPass=Qc,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){X(`Material: parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){X(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(n):r&&r.isVector2&&n&&n.isVector2||r&&r.isEuler&&n&&n.isEuler||r&&r.isVector3&&n&&n.isVector3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e==`string`;t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:`Material`,generator:`Material.toJSON`}};n.uuid=this.uuid,n.type=this.type,this.name!==``&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==1&&(n.blending=this.blending),this.side!==0&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==204&&(n.blendSrc=this.blendSrc),this.blendDst!==205&&(n.blendDst=this.blendDst),this.blendEquation!==100&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==3&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==519&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==7680&&(n.stencilFail=this.stencilFail),this.stencilZFail!==7680&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==7680&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.allowOverride===!1&&(n.allowOverride=!1),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==`round`&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==`round`&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function r(e){let t=[];for(let n in e){let r=e[n];delete r.metadata,t.push(r)}return t}if(t){let t=r(e.textures),i=r(e.images);t.length>0&&(n.textures=t),i.length>0&&(n.images=i)}return n}fromJSON(e,t){if(e.uuid!==void 0&&(this.uuid=e.uuid),e.name!==void 0&&(this.name=e.name),e.color!==void 0&&this.color!==void 0&&this.color.setHex(e.color),e.roughness!==void 0&&(this.roughness=e.roughness),e.metalness!==void 0&&(this.metalness=e.metalness),e.sheen!==void 0&&(this.sheen=e.sheen),e.sheenColor!==void 0&&(this.sheenColor=new Ku().setHex(e.sheenColor)),e.sheenRoughness!==void 0&&(this.sheenRoughness=e.sheenRoughness),e.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(e.emissive),e.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(e.specular),e.specularIntensity!==void 0&&(this.specularIntensity=e.specularIntensity),e.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(e.specularColor),e.shininess!==void 0&&(this.shininess=e.shininess),e.clearcoat!==void 0&&(this.clearcoat=e.clearcoat),e.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=e.clearcoatRoughness),e.dispersion!==void 0&&(this.dispersion=e.dispersion),e.iridescence!==void 0&&(this.iridescence=e.iridescence),e.iridescenceIOR!==void 0&&(this.iridescenceIOR=e.iridescenceIOR),e.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=e.iridescenceThicknessRange),e.transmission!==void 0&&(this.transmission=e.transmission),e.thickness!==void 0&&(this.thickness=e.thickness),e.attenuationDistance!==void 0&&(this.attenuationDistance=e.attenuationDistance),e.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(e.attenuationColor),e.anisotropy!==void 0&&(this.anisotropy=e.anisotropy),e.anisotropyRotation!==void 0&&(this.anisotropyRotation=e.anisotropyRotation),e.fog!==void 0&&(this.fog=e.fog),e.flatShading!==void 0&&(this.flatShading=e.flatShading),e.blending!==void 0&&(this.blending=e.blending),e.combine!==void 0&&(this.combine=e.combine),e.side!==void 0&&(this.side=e.side),e.shadowSide!==void 0&&(this.shadowSide=e.shadowSide),e.opacity!==void 0&&(this.opacity=e.opacity),e.transparent!==void 0&&(this.transparent=e.transparent),e.alphaTest!==void 0&&(this.alphaTest=e.alphaTest),e.alphaHash!==void 0&&(this.alphaHash=e.alphaHash),e.depthFunc!==void 0&&(this.depthFunc=e.depthFunc),e.depthTest!==void 0&&(this.depthTest=e.depthTest),e.depthWrite!==void 0&&(this.depthWrite=e.depthWrite),e.colorWrite!==void 0&&(this.colorWrite=e.colorWrite),e.blendSrc!==void 0&&(this.blendSrc=e.blendSrc),e.blendDst!==void 0&&(this.blendDst=e.blendDst),e.blendEquation!==void 0&&(this.blendEquation=e.blendEquation),e.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=e.blendSrcAlpha),e.blendDstAlpha!==void 0&&(this.blendDstAlpha=e.blendDstAlpha),e.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=e.blendEquationAlpha),e.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(e.blendColor),e.blendAlpha!==void 0&&(this.blendAlpha=e.blendAlpha),e.stencilWriteMask!==void 0&&(this.stencilWriteMask=e.stencilWriteMask),e.stencilFunc!==void 0&&(this.stencilFunc=e.stencilFunc),e.stencilRef!==void 0&&(this.stencilRef=e.stencilRef),e.stencilFuncMask!==void 0&&(this.stencilFuncMask=e.stencilFuncMask),e.stencilFail!==void 0&&(this.stencilFail=e.stencilFail),e.stencilZFail!==void 0&&(this.stencilZFail=e.stencilZFail),e.stencilZPass!==void 0&&(this.stencilZPass=e.stencilZPass),e.stencilWrite!==void 0&&(this.stencilWrite=e.stencilWrite),e.wireframe!==void 0&&(this.wireframe=e.wireframe),e.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=e.wireframeLinewidth),e.wireframeLinecap!==void 0&&(this.wireframeLinecap=e.wireframeLinecap),e.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=e.wireframeLinejoin),e.rotation!==void 0&&(this.rotation=e.rotation),e.linewidth!==void 0&&(this.linewidth=e.linewidth),e.dashSize!==void 0&&(this.dashSize=e.dashSize),e.gapSize!==void 0&&(this.gapSize=e.gapSize),e.scale!==void 0&&(this.scale=e.scale),e.polygonOffset!==void 0&&(this.polygonOffset=e.polygonOffset),e.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=e.polygonOffsetFactor),e.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=e.polygonOffsetUnits),e.dithering!==void 0&&(this.dithering=e.dithering),e.alphaToCoverage!==void 0&&(this.alphaToCoverage=e.alphaToCoverage),e.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=e.premultipliedAlpha),e.forceSinglePass!==void 0&&(this.forceSinglePass=e.forceSinglePass),e.allowOverride!==void 0&&(this.allowOverride=e.allowOverride),e.visible!==void 0&&(this.visible=e.visible),e.toneMapped!==void 0&&(this.toneMapped=e.toneMapped),e.userData!==void 0&&(this.userData=e.userData),e.vertexColors!==void 0&&(typeof e.vertexColors==`number`?this.vertexColors=e.vertexColors>0:this.vertexColors=e.vertexColors),e.size!==void 0&&(this.size=e.size),e.sizeAttenuation!==void 0&&(this.sizeAttenuation=e.sizeAttenuation),e.map!==void 0&&(this.map=t[e.map]||null),e.matcap!==void 0&&(this.matcap=t[e.matcap]||null),e.alphaMap!==void 0&&(this.alphaMap=t[e.alphaMap]||null),e.bumpMap!==void 0&&(this.bumpMap=t[e.bumpMap]||null),e.bumpScale!==void 0&&(this.bumpScale=e.bumpScale),e.normalMap!==void 0&&(this.normalMap=t[e.normalMap]||null),e.normalMapType!==void 0&&(this.normalMapType=e.normalMapType),e.normalScale!==void 0){let t=e.normalScale;Array.isArray(t)===!1&&(t=[t,t]),this.normalScale=new Z().fromArray(t)}return e.displacementMap!==void 0&&(this.displacementMap=t[e.displacementMap]||null),e.displacementScale!==void 0&&(this.displacementScale=e.displacementScale),e.displacementBias!==void 0&&(this.displacementBias=e.displacementBias),e.roughnessMap!==void 0&&(this.roughnessMap=t[e.roughnessMap]||null),e.metalnessMap!==void 0&&(this.metalnessMap=t[e.metalnessMap]||null),e.emissiveMap!==void 0&&(this.emissiveMap=t[e.emissiveMap]||null),e.emissiveIntensity!==void 0&&(this.emissiveIntensity=e.emissiveIntensity),e.specularMap!==void 0&&(this.specularMap=t[e.specularMap]||null),e.specularIntensityMap!==void 0&&(this.specularIntensityMap=t[e.specularIntensityMap]||null),e.specularColorMap!==void 0&&(this.specularColorMap=t[e.specularColorMap]||null),e.envMap!==void 0&&(this.envMap=t[e.envMap]||null),e.envMapRotation!==void 0&&this.envMapRotation.fromArray(e.envMapRotation),e.envMapIntensity!==void 0&&(this.envMapIntensity=e.envMapIntensity),e.reflectivity!==void 0&&(this.reflectivity=e.reflectivity),e.refractionRatio!==void 0&&(this.refractionRatio=e.refractionRatio),e.lightMap!==void 0&&(this.lightMap=t[e.lightMap]||null),e.lightMapIntensity!==void 0&&(this.lightMapIntensity=e.lightMapIntensity),e.aoMap!==void 0&&(this.aoMap=t[e.aoMap]||null),e.aoMapIntensity!==void 0&&(this.aoMapIntensity=e.aoMapIntensity),e.gradientMap!==void 0&&(this.gradientMap=t[e.gradientMap]||null),e.clearcoatMap!==void 0&&(this.clearcoatMap=t[e.clearcoatMap]||null),e.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=t[e.clearcoatRoughnessMap]||null),e.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=t[e.clearcoatNormalMap]||null),e.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new Z().fromArray(e.clearcoatNormalScale)),e.iridescenceMap!==void 0&&(this.iridescenceMap=t[e.iridescenceMap]||null),e.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=t[e.iridescenceThicknessMap]||null),e.transmissionMap!==void 0&&(this.transmissionMap=t[e.transmissionMap]||null),e.thicknessMap!==void 0&&(this.thicknessMap=t[e.thicknessMap]||null),e.anisotropyMap!==void 0&&(this.anisotropyMap=t[e.anisotropyMap]||null),e.sheenColorMap!==void 0&&(this.sheenColorMap=t[e.sheenColorMap]||null),e.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=t[e.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let e=t.length;n=Array(e);for(let r=0;r!==e;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:`dispose`})}set needsUpdate(e){e===!0&&this.version++}},Kd=new Q,qd=new Q,Jd=new Q,Yd=new Q,Xd=new Q,Zd=new Q,Qd=new Q,$d=class{constructor(e=new Q,t=new Q(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Kd)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=Kd.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(Kd.copy(this.origin).addScaledVector(this.direction,t),Kd.distanceToSquared(e))}distanceSqToSegment(e,t,n,r){qd.copy(e).add(t).multiplyScalar(.5),Jd.copy(t).sub(e).normalize(),Yd.copy(this.origin).sub(qd);let i=e.distanceTo(t)*.5,a=-this.direction.dot(Jd),o=Yd.dot(this.direction),s=-Yd.dot(Jd),c=Yd.lengthSq(),l=Math.abs(1-a*a),u,d,f,p;if(l>0)if(u=a*s-o,d=a*o-s,p=i*l,u>=0)if(d>=-p)if(d<=p){let e=1/l;u*=e,d*=e,f=u*(u+a*d+2*o)+d*(a*u+d+2*s)+c}else d=i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c;else d=-i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c;else d<=-p?(u=Math.max(0,-(-a*i+o)),d=u>0?-i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c):d<=p?(u=0,d=Math.min(Math.max(-i,-s),i),f=d*(d+2*s)+c):(u=Math.max(0,-(a*i+o)),d=u>0?i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c);else d=a>0?-i:i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),r&&r.copy(qd).addScaledVector(Jd,d),f}intersectSphere(e,t){Kd.subVectors(e.center,this.origin);let n=Kd.dot(this.direction),r=Kd.dot(Kd)-n*n,i=e.radius*e.radius;if(r>i)return null;let a=Math.sqrt(i-r),o=n-a,s=n+a;return s<0?null:o<0?this.at(s,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,r,i,a,o,s,c=1/this.direction.x,l=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,r=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,r=(e.min.x-d.x)*c),l>=0?(i=(e.min.y-d.y)*l,a=(e.max.y-d.y)*l):(i=(e.max.y-d.y)*l,a=(e.min.y-d.y)*l),n>a||i>r||((i>n||isNaN(n))&&(n=i),(a<r||isNaN(r))&&(r=a),u>=0?(o=(e.min.z-d.z)*u,s=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,s=(e.min.z-d.z)*u),n>s||o>r)||((o>n||n!==n)&&(n=o),(s<r||r!==r)&&(r=s),r<0)?null:this.at(n>=0?n:r,t)}intersectsBox(e){return this.intersectBox(e,Kd)!==null}intersectTriangle(e,t,n,r,i){Xd.subVectors(t,e),Zd.subVectors(n,e),Qd.crossVectors(Xd,Zd);let a=this.direction.dot(Qd),o;if(a>0){if(r)return null;o=1}else if(a<0)o=-1,a=-a;else return null;Yd.subVectors(this.origin,e);let s=o*this.direction.dot(Zd.crossVectors(Yd,Zd));if(s<0)return null;let c=o*this.direction.dot(Xd.cross(Yd));if(c<0||s+c>a)return null;let l=-o*Yd.dot(Qd);return l<0?null:this.at(l/a,i)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},ef=class extends Gd{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type=`MeshBasicMaterial`,this.color=new Ku(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new xu,this.combine=0,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},tf=new du,nf=new $d,rf=new Fd,af=new Q,of=new Q,sf=new Q,cf=new Q,lf=new Q,uf=new Q,df=new Q,ff=new Q,pf=class extends Ru{constructor(e=new Ud,t=new ef){super(),this.isMesh=!0,this.type=`Mesh`,this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let e=this.geometry.morphAttributes,t=Object.keys(e);if(t.length>0){let n=e[t[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let e=0,t=n.length;e<t;e++){let t=n[e].name||String(e);this.morphTargetInfluences.push(0),this.morphTargetDictionary[t]=e}}}}getVertexPosition(e,t){let n=this.geometry,r=n.attributes.position,i=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(r,e);let o=this.morphTargetInfluences;if(i&&o){uf.set(0,0,0);for(let n=0,r=i.length;n<r;n++){let r=o[n],s=i[n];r!==0&&(lf.fromBufferAttribute(s,e),a?uf.addScaledVector(lf,r):uf.addScaledVector(lf.sub(t),r))}t.add(uf)}return t}raycast(e,t){let n=this.geometry,r=this.material,i=this.matrixWorld;r!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),rf.copy(n.boundingSphere),rf.applyMatrix4(i),nf.copy(e.ray).recast(e.near),!(rf.containsPoint(nf.origin)===!1&&(nf.intersectSphere(rf,af)===null||nf.origin.distanceToSquared(af)>(e.far-e.near)**2))&&(tf.copy(i).invert(),nf.copy(e.ray).applyMatrix4(tf),!(n.boundingBox!==null&&nf.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,nf)))}_computeIntersections(e,t,n){let r,i=this.geometry,a=this.material,o=i.index,s=i.attributes.position,c=i.attributes.uv,l=i.attributes.uv1,u=i.attributes.normal,d=i.groups,f=i.drawRange;if(o!==null)if(Array.isArray(a))for(let i=0,s=d.length;i<s;i++){let s=d[i],p=a[s.materialIndex],m=Math.max(s.start,f.start),h=Math.min(o.count,Math.min(s.start+s.count,f.start+f.count));for(let i=m,a=h;i<a;i+=3){let a=o.getX(i),d=o.getX(i+1),f=o.getX(i+2);r=hf(this,p,e,n,c,l,u,a,d,f),r&&(r.faceIndex=Math.floor(i/3),r.face.materialIndex=s.materialIndex,t.push(r))}}else{let i=Math.max(0,f.start),s=Math.min(o.count,f.start+f.count);for(let d=i,f=s;d<f;d+=3){let i=o.getX(d),s=o.getX(d+1),f=o.getX(d+2);r=hf(this,a,e,n,c,l,u,i,s,f),r&&(r.faceIndex=Math.floor(d/3),t.push(r))}}else if(s!==void 0)if(Array.isArray(a))for(let i=0,o=d.length;i<o;i++){let o=d[i],p=a[o.materialIndex],m=Math.max(o.start,f.start),h=Math.min(s.count,Math.min(o.start+o.count,f.start+f.count));for(let i=m,a=h;i<a;i+=3){let a=i,s=i+1,d=i+2;r=hf(this,p,e,n,c,l,u,a,s,d),r&&(r.faceIndex=Math.floor(i/3),r.face.materialIndex=o.materialIndex,t.push(r))}}else{let i=Math.max(0,f.start),o=Math.min(s.count,f.start+f.count);for(let s=i,d=o;s<d;s+=3){let i=s,o=s+1,d=s+2;r=hf(this,a,e,n,c,l,u,i,o,d),r&&(r.faceIndex=Math.floor(s/3),t.push(r))}}}};function mf(e,t,n,r,i,a,o,s){let c;if(c=t.side===1?r.intersectTriangle(o,a,i,!0,s):r.intersectTriangle(i,a,o,t.side===0,s),c===null)return null;ff.copy(s),ff.applyMatrix4(e.matrixWorld);let l=n.ray.origin.distanceTo(ff);return l<n.near||l>n.far?null:{distance:l,point:ff.clone(),object:e}}function hf(e,t,n,r,i,a,o,s,c,l){e.getVertexPosition(s,of),e.getVertexPosition(c,sf),e.getVertexPosition(l,cf);let u=mf(e,t,n,r,of,sf,cf,df);if(u){let e=new Q;ld.getBarycoord(df,of,sf,cf,e),i&&(u.uv=ld.getInterpolatedAttribute(i,s,c,l,e,new Z)),a&&(u.uv1=ld.getInterpolatedAttribute(a,s,c,l,e,new Z)),o&&(u.normal=ld.getInterpolatedAttribute(o,s,c,l,e,new Q),u.normal.dot(r.direction)>0&&u.normal.multiplyScalar(-1));let t={a:s,b:c,c:l,normal:new Q,materialIndex:0};ld.getNormal(of,sf,cf,t.normal),u.face=t,u.barycoord=e}return u}var gf=class extends au{constructor(e=null,t=1,n=1,r,i,a,o,s,c=ks,l=ks,u,d){super(null,a,o,s,c,l,r,i,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},_f=class extends Od{constructor(e,t,n,r=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=r}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},vf=new du,yf=new du,bf=[],xf=new ud,Sf=new du,Cf=new pf,wf=new Fd,Tf=class extends pf{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new _f(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let e=0;e<n;e++)this.setMatrixAt(e,Sf)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new ud),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,vf),xf.copy(e.boundingBox).applyMatrix4(vf),this.boundingBox.union(xf)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new Fd),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,vf),wf.copy(e.boundingSphere).applyMatrix4(vf),this.boundingSphere.union(wf)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){return this.instanceColor===null?t.setRGB(1,1,1):t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){return t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,r=this.morphTexture.source.data.data,i=e*(n.length+1)+1;for(let e=0;e<n.length;e++)n[e]=r[i+e]}raycast(e,t){let n=this.matrixWorld,r=this.count;if(Cf.geometry=this.geometry,Cf.material=this.material,Cf.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),wf.copy(this.boundingSphere),wf.applyMatrix4(n),e.ray.intersectsSphere(wf)!==!1))for(let i=0;i<r;i++){this.getMatrixAt(i,vf),yf.multiplyMatrices(n,vf),Cf.matrixWorld=yf,Cf.raycast(e,bf);for(let e=0,n=bf.length;e<n;e++){let n=bf[e];n.instanceId=i,n.object=this,t.push(n)}bf.length=0}}setColorAt(e,t){return this.instanceColor===null&&(this.instanceColor=new _f(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3),this}setMatrixAt(e,t){return t.toArray(this.instanceMatrix.array,e*16),this}setMorphAt(e,t){let n=t.morphTargetInfluences,r=n.length+1;this.morphTexture===null&&(this.morphTexture=new gf(new Float32Array(r*this.count),r,this.count,$s,Vs));let i=this.morphTexture.source.data.data,a=0;for(let e=0;e<n.length;e++)a+=n[e];let o=this.geometry.morphTargetsRelative?1:1-a,s=r*e;return i[s]=o,i.set(n,s+1),this}updateMorphTargets(){}dispose(){this.dispatchEvent({type:`dispose`}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},Ef=new Q,Df=new Q,Of=new Wl,kf=class{constructor(e=new Q(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,r){return this.normal.set(e,t,n),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let r=Ef.subVectors(n,t).cross(Df.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let r=e.delta(Ef),i=this.normal.dot(r);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/i;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(r,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||Of.getNormalMatrix(e),r=this.coplanarPoint(Ef).applyMatrix4(e),i=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(i),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},Af=new Fd,jf=new Z(.5,.5),Mf=new Q,Nf=class{constructor(e=new kf,t=new kf,n=new kf,r=new kf,i=new kf,a=new kf){this.planes=[e,t,n,r,i,a]}set(e,t,n,r,i,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(r),o[4].copy(i),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=tl,n=!1){let r=this.planes,i=e.elements,a=i[0],o=i[1],s=i[2],c=i[3],l=i[4],u=i[5],d=i[6],f=i[7],p=i[8],m=i[9],h=i[10],g=i[11],_=i[12],v=i[13],y=i[14],b=i[15];if(r[0].setComponents(c-a,f-l,g-p,b-_).normalize(),r[1].setComponents(c+a,f+l,g+p,b+_).normalize(),r[2].setComponents(c+o,f+u,g+m,b+v).normalize(),r[3].setComponents(c-o,f-u,g-m,b-v).normalize(),n)r[4].setComponents(s,d,h,y).normalize(),r[5].setComponents(c-s,f-d,g-h,b-y).normalize();else if(r[4].setComponents(c-s,f-d,g-h,b-y).normalize(),t===2e3)r[5].setComponents(c+s,f+d,g+h,b+y).normalize();else if(t===2001)r[5].setComponents(s,d,h,y).normalize();else throw Error(`THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: `+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Af.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Af.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Af)}intersectsSprite(e){return Af.center.set(0,0,0),Af.radius=.7071067811865476+jf.distanceTo(e.center),Af.applyMatrix4(e.matrixWorld),this.intersectsSphere(Af)}intersectsSphere(e){let t=this.planes,n=e.center,r=-e.radius;for(let e=0;e<6;e++)if(t[e].distanceToPoint(n)<r)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let r=t[n];if(Mf.x=r.normal.x>0?e.max.x:e.min.x,Mf.y=r.normal.y>0?e.max.y:e.min.y,Mf.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(Mf)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},Pf=class extends Gd{constructor(e){super(),this.isPointsMaterial=!0,this.type=`PointsMaterial`,this.color=new Ku(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},Ff=new du,If=new $d,Lf=new Fd,Rf=new Q,zf=class extends Ru{constructor(e=new Ud,t=new Pf){super(),this.isPoints=!0,this.type=`Points`,this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){let n=this.geometry,r=this.matrixWorld,i=e.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Lf.copy(n.boundingSphere),Lf.applyMatrix4(r),Lf.radius+=i,e.ray.intersectsSphere(Lf)===!1)return;Ff.copy(r).invert(),If.copy(e.ray).applyMatrix4(Ff);let o=i/((this.scale.x+this.scale.y+this.scale.z)/3),s=o*o,c=n.index,l=n.attributes.position;if(c!==null){let n=Math.max(0,a.start),i=Math.min(c.count,a.start+a.count);for(let a=n,o=i;a<o;a++){let n=c.getX(a);Rf.fromBufferAttribute(l,n),Bf(Rf,n,s,r,e,t,this)}}else{let n=Math.max(0,a.start),i=Math.min(l.count,a.start+a.count);for(let a=n,o=i;a<o;a++)Rf.fromBufferAttribute(l,a),Bf(Rf,a,s,r,e,t,this)}}updateMorphTargets(){let e=this.geometry.morphAttributes,t=Object.keys(e);if(t.length>0){let n=e[t[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let e=0,t=n.length;e<t;e++){let t=n[e].name||String(e);this.morphTargetInfluences.push(0),this.morphTargetDictionary[t]=e}}}}};function Bf(e,t,n,r,i,a,o){let s=If.distanceSqToPoint(e);if(s<n){let n=new Q;If.closestPointToPoint(e,n),n.applyMatrix4(r);let c=i.ray.origin.distanceTo(n);if(c<i.near||c>i.far)return;a.push({distance:c,distanceToRay:Math.sqrt(s),point:n,index:t,face:null,faceIndex:null,barycoord:null,object:o})}}var Vf=class extends au{constructor(e=[],t=301,n,r,i,a,o,s,c,l){super(e,t,n,r,i,a,o,s,c,l),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},Hf=class extends au{constructor(e,t,n,r,i,a,o,s,c){super(e,t,n,r,i,a,o,s,c),this.isCanvasTexture=!0,this.needsUpdate=!0}},Uf=class extends au{constructor(e,t,n=Bs,r,i,a,o=ks,s=ks,c,l=Zs,u=1){if(l!==1026&&l!==1027)throw Error(`THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat`);super({width:e,height:t,depth:u},r,i,a,o,s,l,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new tu(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},Wf=class extends Uf{constructor(e,t=Bs,n=301,r,i,a=ks,o=ks,s,c=Zs){let l={width:e,height:e,depth:1},u=[l,l,l,l,l,l];super(e,e,t,n,r,i,a,o,s,c),this.image=u,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Gf=class extends au{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Kf=class e extends Ud{constructor(e=1,t=1,n=1,r=1,i=1,a=1){super(),this.type=`BoxGeometry`,this.parameters={width:e,height:t,depth:n,widthSegments:r,heightSegments:i,depthSegments:a};let o=this;r=Math.floor(r),i=Math.floor(i),a=Math.floor(a);let s=[],c=[],l=[],u=[],d=0,f=0;p(`z`,`y`,`x`,-1,-1,n,t,e,a,i,0),p(`z`,`y`,`x`,1,-1,n,t,-e,a,i,1),p(`x`,`z`,`y`,1,1,e,n,t,r,a,2),p(`x`,`z`,`y`,1,-1,e,n,-t,r,a,3),p(`x`,`y`,`z`,1,-1,e,t,n,r,i,4),p(`x`,`y`,`z`,-1,-1,e,t,-n,r,i,5),this.setIndex(s),this.setAttribute(`position`,new jd(c,3)),this.setAttribute(`normal`,new jd(l,3)),this.setAttribute(`uv`,new jd(u,2));function p(e,t,n,r,i,a,p,m,h,g,_){let v=a/h,y=p/g,b=a/2,x=p/2,S=m/2,C=h+1,w=g+1,T=0,E=0,D=new Q;for(let a=0;a<w;a++){let o=a*y-x;for(let s=0;s<C;s++)D[e]=(s*v-b)*r,D[t]=o*i,D[n]=S,c.push(D.x,D.y,D.z),D[e]=0,D[t]=0,D[n]=m>0?1:-1,l.push(D.x,D.y,D.z),u.push(s/h),u.push(1-a/g),T+=1}for(let e=0;e<g;e++)for(let t=0;t<h;t++){let n=d+t+C*e,r=d+t+C*(e+1),i=d+(t+1)+C*(e+1),a=d+(t+1)+C*e;s.push(n,r,a),s.push(r,i,a),E+=6}o.addGroup(f,E,_),f+=E,d+=T}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}},qf=class e extends Ud{constructor(e=1,t=1,n=4,r=8,i=1){super(),this.type=`CapsuleGeometry`,this.parameters={radius:e,height:t,capSegments:n,radialSegments:r,heightSegments:i},t=Math.max(0,t),n=Math.max(1,Math.floor(n)),r=Math.max(3,Math.floor(r)),i=Math.max(1,Math.floor(i));let a=[],o=[],s=[],c=[],l=t/2,u=Math.PI/2*e,d=t,f=2*u+d,p=n*2+i,m=r+1,h=new Q,g=new Q;for(let _=0;_<=p;_++){let v=0,y=0,b=0,x=0;if(_<=n){let t=_/n,r=t*Math.PI/2;y=-l-e*Math.cos(r),b=e*Math.sin(r),x=-e*Math.cos(r),v=t*u}else if(_<=n+i){let r=(_-n)/i;y=-l+r*t,b=e,x=0,v=u+r*d}else{let t=(_-n-i)/n,r=t*Math.PI/2;y=l+e*Math.sin(r),b=e*Math.cos(r),x=e*Math.sin(r),v=u+d+t*u}let S=Math.max(0,Math.min(1,v/f)),C=0;_===0?C=.5/r:_===p&&(C=-.5/r);for(let e=0;e<=r;e++){let t=e/r,n=t*Math.PI*2,i=Math.sin(n),a=Math.cos(n);g.x=-b*a,g.y=y,g.z=b*i,o.push(g.x,g.y,g.z),h.set(-b*a,x,b*i),h.normalize(),s.push(h.x,h.y,h.z),c.push(t+C,S)}if(_>0){let e=(_-1)*m;for(let t=0;t<r;t++){let n=e+t,r=e+t+1,i=_*m+t,o=_*m+t+1;a.push(n,r,i),a.push(r,o,i)}}}this.setIndex(a),this.setAttribute(`position`,new jd(o,3)),this.setAttribute(`normal`,new jd(s,3)),this.setAttribute(`uv`,new jd(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radius,t.height,t.capSegments,t.radialSegments,t.heightSegments)}},Jf=class e extends Ud{constructor(e=1,t=32,n=0,r=Math.PI*2){super(),this.type=`CircleGeometry`,this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:r},t=Math.max(3,t);let i=[],a=[],o=[],s=[],c=new Q,l=new Z;a.push(0,0,0),o.push(0,0,1),s.push(.5,.5);for(let i=0,u=3;i<=t;i++,u+=3){let d=n+i/t*r;c.x=e*Math.cos(d),c.y=e*Math.sin(d),a.push(c.x,c.y,c.z),o.push(0,0,1),l.x=(a[u]/e+1)/2,l.y=(a[u+1]/e+1)/2,s.push(l.x,l.y)}for(let e=1;e<=t;e++)i.push(e,e+1,0);this.setIndex(i),this.setAttribute(`position`,new jd(a,3)),this.setAttribute(`normal`,new jd(o,3)),this.setAttribute(`uv`,new jd(s,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radius,t.segments,t.thetaStart,t.thetaLength)}},Yf=class e extends Ud{constructor(e=1,t=1,n=1,r=32,i=1,a=!1,o=0,s=Math.PI*2){super(),this.type=`CylinderGeometry`,this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:r,heightSegments:i,openEnded:a,thetaStart:o,thetaLength:s};let c=this;r=Math.floor(r),i=Math.floor(i);let l=[],u=[],d=[],f=[],p=0,m=[],h=n/2,g=0;_(),a===!1&&(e>0&&v(!0),t>0&&v(!1)),this.setIndex(l),this.setAttribute(`position`,new jd(u,3)),this.setAttribute(`normal`,new jd(d,3)),this.setAttribute(`uv`,new jd(f,2));function _(){let a=new Q,_=new Q,v=0,y=(t-e)/n;for(let c=0;c<=i;c++){let l=[],g=c/i,v=g*(t-e)+e;for(let e=0;e<=r;e++){let t=e/r,i=t*s+o,c=Math.sin(i),m=Math.cos(i);_.x=v*c,_.y=-g*n+h,_.z=v*m,u.push(_.x,_.y,_.z),a.set(c,y,m).normalize(),d.push(a.x,a.y,a.z),f.push(t,1-g),l.push(p++)}m.push(l)}for(let n=0;n<r;n++)for(let r=0;r<i;r++){let a=m[r][n],o=m[r+1][n],s=m[r+1][n+1],c=m[r][n+1];(e>0||r!==0)&&(l.push(a,o,c),v+=3),(t>0||r!==i-1)&&(l.push(o,s,c),v+=3)}c.addGroup(g,v,0),g+=v}function v(n){let i=p,a=new Z,m=new Q,_=0,v=n===!0?e:t,y=n===!0?1:-1;for(let e=1;e<=r;e++)u.push(0,h*y,0),d.push(0,y,0),f.push(.5,.5),p++;let b=p;for(let e=0;e<=r;e++){let t=e/r*s+o,n=Math.cos(t),i=Math.sin(t);m.x=v*i,m.y=h*y,m.z=v*n,u.push(m.x,m.y,m.z),d.push(0,y,0),a.x=n*.5+.5,a.y=i*.5*y+.5,f.push(a.x,a.y),p++}for(let e=0;e<r;e++){let t=i+e,r=b+e;n===!0?l.push(r,r+1,t):l.push(r+1,r,t),_+=3}c.addGroup(g,_,n===!0?1:2),g+=_}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}},Xf=class e extends Yf{constructor(e=1,t=1,n=32,r=1,i=!1,a=0,o=Math.PI*2){super(0,e,t,n,r,i,a,o),this.type=`ConeGeometry`,this.parameters={radius:e,height:t,radialSegments:n,heightSegments:r,openEnded:i,thetaStart:a,thetaLength:o}}static fromJSON(t){return new e(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}},Zf=class{constructor(){this.type=`Curve`,this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){X(`Curve: .getPoint() not implemented.`)}getPointAt(e,t){let n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){let t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){let e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let t=[],n,r=this.getPoint(0),i=0;t.push(0);for(let a=1;a<=e;a++)n=this.getPoint(a/e),i+=n.distanceTo(r),t.push(i),r=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){let n=this.getLengths(),r=0,i=n.length,a;a=t||e*n[i-1];let o=0,s=i-1,c;for(;o<=s;)if(r=Math.floor(o+(s-o)/2),c=n[r]-a,c<0)o=r+1;else if(c>0)s=r-1;else{s=r;break}if(r=s,n[r]===a)return r/(i-1);let l=n[r],u=n[r+1]-l,d=(a-l)/u;return(r+d)/(i-1)}getTangent(e,t){let n=1e-4,r=e-n,i=e+n;r<0&&(r=0),i>1&&(i=1);let a=this.getPoint(r),o=this.getPoint(i),s=t||(a.isVector2?new Z:new Q);return s.copy(o).sub(a).normalize(),s}getTangentAt(e,t){let n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t=!1){let n=new Q,r=[],i=[],a=[],o=new Q,s=new du;for(let t=0;t<=e;t++){let n=t/e;r[t]=this.getTangentAt(n,new Q)}i[0]=new Q,a[0]=new Q;let c=Number.MAX_VALUE,l=Math.abs(r[0].x),u=Math.abs(r[0].y),d=Math.abs(r[0].z);l<=c&&(c=l,n.set(1,0,0)),u<=c&&(c=u,n.set(0,1,0)),d<=c&&n.set(0,0,1),o.crossVectors(r[0],n).normalize(),i[0].crossVectors(r[0],o),a[0].crossVectors(r[0],i[0]);for(let t=1;t<=e;t++){if(i[t]=i[t-1].clone(),a[t]=a[t-1].clone(),o.crossVectors(r[t-1],r[t]),o.length()>2**-52){o.normalize();let e=Math.acos(yl(r[t-1].dot(r[t]),-1,1));i[t].applyMatrix4(s.makeRotationAxis(o,e))}a[t].crossVectors(r[t],i[t])}if(t===!0){let t=Math.acos(yl(i[0].dot(i[e]),-1,1));t/=e,r[0].dot(o.crossVectors(i[0],i[e]))>0&&(t=-t);for(let n=1;n<=e;n++)i[n].applyMatrix4(s.makeRotationAxis(r[n],t*n)),a[n].crossVectors(r[n],i[n])}return{tangents:r,normals:i,binormals:a}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){let e={metadata:{version:4.7,type:`Curve`,generator:`Curve.toJSON`}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}},Qf=class extends Zf{constructor(e=0,t=0,n=1,r=1,i=0,a=Math.PI*2,o=!1,s=0){super(),this.isEllipseCurve=!0,this.type=`EllipseCurve`,this.aX=e,this.aY=t,this.xRadius=n,this.yRadius=r,this.aStartAngle=i,this.aEndAngle=a,this.aClockwise=o,this.aRotation=s}getPoint(e,t=new Z){let n=t,r=Math.PI*2,i=this.aEndAngle-this.aStartAngle,a=Math.abs(i)<2**-52;for(;i<0;)i+=r;for(;i>r;)i-=r;i<2**-52&&(i=a?0:r),this.aClockwise===!0&&!a&&(i===r?i=-r:i-=r);let o=this.aStartAngle+e*i,s=this.aX+this.xRadius*Math.cos(o),c=this.aY+this.yRadius*Math.sin(o);if(this.aRotation!==0){let e=Math.cos(this.aRotation),t=Math.sin(this.aRotation),n=s-this.aX,r=c-this.aY;s=n*e-r*t+this.aX,c=n*t+r*e+this.aY}return n.set(s,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){let e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}},$f=class extends Qf{constructor(e,t,n,r,i,a){super(e,t,n,n,r,i,a),this.isArcCurve=!0,this.type=`ArcCurve`}};function ep(){let e=0,t=0,n=0,r=0;function i(i,a,o,s){e=i,t=o,n=-3*i+3*a-2*o-s,r=2*i-2*a+o+s}return{initCatmullRom:function(e,t,n,r,a){i(t,n,a*(n-e),a*(r-t))},initNonuniformCatmullRom:function(e,t,n,r,a,o,s){let c=(t-e)/a-(n-e)/(a+o)+(n-t)/o,l=(n-t)/o-(r-t)/(o+s)+(r-n)/s;c*=o,l*=o,i(t,n,c,l)},calc:function(i){let a=i*i,o=a*i;return e+t*i+n*a+r*o}}}var tp=new Q,np=new Q,rp=new ep,ip=new ep,ap=new ep,op=class extends Zf{constructor(e=[],t=!1,n=`centripetal`,r=.5){super(),this.isCatmullRomCurve3=!0,this.type=`CatmullRomCurve3`,this.points=e,this.closed=t,this.curveType=n,this.tension=r}getPoint(e,t=new Q){let n=t,r=this.points,i=r.length,a=(i-+!this.closed)*e,o=Math.floor(a),s=a-o;this.closed?o+=o>0?0:(Math.floor(Math.abs(o)/i)+1)*i:s===0&&o===i-1&&(o=i-2,s=1);let c,l;this.closed||o>0?c=r[(o-1)%i]:(np.subVectors(r[0],r[1]).add(r[0]),c=np);let u=r[o%i],d=r[(o+1)%i];if(this.closed||o+2<i?l=r[(o+2)%i]:(tp.subVectors(r[i-1],r[i-2]).add(r[i-1]),l=tp),this.curveType===`centripetal`||this.curveType===`chordal`){let e=this.curveType===`chordal`?.5:.25,t=c.distanceToSquared(u)**+e,n=u.distanceToSquared(d)**+e,r=d.distanceToSquared(l)**+e;n<1e-4&&(n=1),t<1e-4&&(t=n),r<1e-4&&(r=n),rp.initNonuniformCatmullRom(c.x,u.x,d.x,l.x,t,n,r),ip.initNonuniformCatmullRom(c.y,u.y,d.y,l.y,t,n,r),ap.initNonuniformCatmullRom(c.z,u.z,d.z,l.z,t,n,r)}else this.curveType===`catmullrom`&&(rp.initCatmullRom(c.x,u.x,d.x,l.x,this.tension),ip.initCatmullRom(c.y,u.y,d.y,l.y,this.tension),ap.initCatmullRom(c.z,u.z,d.z,l.z,this.tension));return n.set(rp.calc(s),ip.calc(s),ap.calc(s)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let n=e.points[t];this.points.push(n.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let n=this.points[t];e.points.push(n.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let n=e.points[t];this.points.push(new Q().fromArray(n))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}};function sp(e,t,n,r,i){let a=(r-t)*.5,o=(i-n)*.5,s=e*e,c=e*s;return(2*n-2*r+a+o)*c+(-3*n+3*r-2*a-o)*s+a*e+n}function cp(e,t){let n=1-e;return n*n*t}function lp(e,t){return 2*(1-e)*e*t}function up(e,t){return e*e*t}function dp(e,t,n,r){return cp(e,t)+lp(e,n)+up(e,r)}function fp(e,t){let n=1-e;return n*n*n*t}function pp(e,t){let n=1-e;return 3*n*n*e*t}function mp(e,t){return 3*(1-e)*e*e*t}function hp(e,t){return e*e*e*t}function gp(e,t,n,r,i){return fp(e,t)+pp(e,n)+mp(e,r)+hp(e,i)}var _p=class extends Zf{constructor(e=new Z,t=new Z,n=new Z,r=new Z){super(),this.isCubicBezierCurve=!0,this.type=`CubicBezierCurve`,this.v0=e,this.v1=t,this.v2=n,this.v3=r}getPoint(e,t=new Z){let n=t,r=this.v0,i=this.v1,a=this.v2,o=this.v3;return n.set(gp(e,r.x,i.x,a.x,o.x),gp(e,r.y,i.y,a.y,o.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},vp=class extends Zf{constructor(e=new Q,t=new Q,n=new Q,r=new Q){super(),this.isCubicBezierCurve3=!0,this.type=`CubicBezierCurve3`,this.v0=e,this.v1=t,this.v2=n,this.v3=r}getPoint(e,t=new Q){let n=t,r=this.v0,i=this.v1,a=this.v2,o=this.v3;return n.set(gp(e,r.x,i.x,a.x,o.x),gp(e,r.y,i.y,a.y,o.y),gp(e,r.z,i.z,a.z,o.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}},yp=class extends Zf{constructor(e=new Z,t=new Z){super(),this.isLineCurve=!0,this.type=`LineCurve`,this.v1=e,this.v2=t}getPoint(e,t=new Z){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new Z){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},bp=class extends Zf{constructor(e=new Q,t=new Q){super(),this.isLineCurve3=!0,this.type=`LineCurve3`,this.v1=e,this.v2=t}getPoint(e,t=new Q){let n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new Q){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},xp=class extends Zf{constructor(e=new Z,t=new Z,n=new Z){super(),this.isQuadraticBezierCurve=!0,this.type=`QuadraticBezierCurve`,this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new Z){let n=t,r=this.v0,i=this.v1,a=this.v2;return n.set(dp(e,r.x,i.x,a.x),dp(e,r.y,i.y,a.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Sp=class extends Zf{constructor(e=new Q,t=new Q,n=new Q){super(),this.isQuadraticBezierCurve3=!0,this.type=`QuadraticBezierCurve3`,this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new Q){let n=t,r=this.v0,i=this.v1,a=this.v2;return n.set(dp(e,r.x,i.x,a.x),dp(e,r.y,i.y,a.y),dp(e,r.z,i.z,a.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){let e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}},Cp=Object.freeze({__proto__:null,ArcCurve:$f,CatmullRomCurve3:op,CubicBezierCurve:_p,CubicBezierCurve3:vp,EllipseCurve:Qf,LineCurve:yp,LineCurve3:bp,QuadraticBezierCurve:xp,QuadraticBezierCurve3:Sp,SplineCurve:class extends Zf{constructor(e=[]){super(),this.isSplineCurve=!0,this.type=`SplineCurve`,this.points=e}getPoint(e,t=new Z){let n=t,r=this.points,i=(r.length-1)*e,a=Math.floor(i),o=i-a,s=r[a===0?a:a-1],c=r[a],l=r[a>r.length-2?r.length-1:a+1],u=r[a>r.length-3?r.length-1:a+2];return n.set(sp(o,s.x,c.x,l.x,u.x),sp(o,s.y,c.y,l.y,u.y)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let n=e.points[t];this.points.push(n.clone())}return this}toJSON(){let e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){let n=this.points[t];e.points.push(n.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){let n=e.points[t];this.points.push(new Z().fromArray(n))}return this}}}),wp=class e extends Ud{constructor(e=1,t=1,n=1,r=1){super(),this.type=`PlaneGeometry`,this.parameters={width:e,height:t,widthSegments:n,heightSegments:r};let i=e/2,a=t/2,o=Math.floor(n),s=Math.floor(r),c=o+1,l=s+1,u=e/o,d=t/s,f=[],p=[],m=[],h=[];for(let e=0;e<l;e++){let t=e*d-a;for(let n=0;n<c;n++){let r=n*u-i;p.push(r,-t,0),m.push(0,0,1),h.push(n/o),h.push(1-e/s)}}for(let e=0;e<s;e++)for(let t=0;t<o;t++){let n=t+c*e,r=t+c*(e+1),i=t+1+c*(e+1),a=t+1+c*e;f.push(n,r,a),f.push(r,i,a)}this.setIndex(f),this.setAttribute(`position`,new jd(p,3)),this.setAttribute(`normal`,new jd(m,3)),this.setAttribute(`uv`,new jd(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.width,t.height,t.widthSegments,t.heightSegments)}},Tp=class e extends Ud{constructor(e=.5,t=1,n=32,r=1,i=0,a=Math.PI*2){super(),this.type=`RingGeometry`,this.parameters={innerRadius:e,outerRadius:t,thetaSegments:n,phiSegments:r,thetaStart:i,thetaLength:a},n=Math.max(3,n),r=Math.max(1,r);let o=[],s=[],c=[],l=[],u=e,d=(t-e)/r,f=new Q,p=new Z;for(let e=0;e<=r;e++){for(let e=0;e<=n;e++){let r=i+e/n*a;f.x=u*Math.cos(r),f.y=u*Math.sin(r),s.push(f.x,f.y,f.z),c.push(0,0,1),p.x=(f.x/t+1)/2,p.y=(f.y/t+1)/2,l.push(p.x,p.y)}u+=d}for(let e=0;e<r;e++){let t=e*(n+1);for(let e=0;e<n;e++){let r=e+t,i=r,a=r+n+1,s=r+n+2,c=r+1;o.push(i,a,c),o.push(a,s,c)}}this.setIndex(o),this.setAttribute(`position`,new jd(s,3)),this.setAttribute(`normal`,new jd(c,3)),this.setAttribute(`uv`,new jd(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.innerRadius,t.outerRadius,t.thetaSegments,t.phiSegments,t.thetaStart,t.thetaLength)}},Ep=class e extends Ud{constructor(e=1,t=32,n=16,r=0,i=Math.PI*2,a=0,o=Math.PI){super(),this.type=`SphereGeometry`,this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:r,phiLength:i,thetaStart:a,thetaLength:o},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let s=Math.min(a+o,Math.PI),c=0,l=[],u=new Q,d=new Q,f=[],p=[],m=[],h=[];for(let f=0;f<=n;f++){let g=[],_=f/n,v=a+_*o,y=e*Math.cos(v),b=Math.sqrt(e*e-y*y),x=0;f===0&&a===0?x=.5/t:f===n&&s===Math.PI&&(x=-.5/t);for(let e=0;e<=t;e++){let n=e/t,a=r+n*i;u.x=-b*Math.cos(a),u.y=y,u.z=b*Math.sin(a),p.push(u.x,u.y,u.z),d.copy(u).normalize(),m.push(d.x,d.y,d.z),h.push(n+x,1-_),g.push(c++)}l.push(g)}for(let e=0;e<n;e++)for(let r=0;r<t;r++){let t=l[e][r+1],i=l[e][r],o=l[e+1][r],c=l[e+1][r+1];(e!==0||a>0)&&f.push(t,i,c),(e!==n-1||s<Math.PI)&&f.push(i,o,c)}this.setIndex(f),this.setAttribute(`position`,new jd(p,3)),this.setAttribute(`normal`,new jd(m,3)),this.setAttribute(`uv`,new jd(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}},Dp=class e extends Ud{constructor(e=new Sp(new Q(-1,-1,0),new Q(-1,1,0),new Q(1,1,0)),t=64,n=1,r=8,i=!1){super(),this.type=`TubeGeometry`,this.parameters={path:e,tubularSegments:t,radius:n,radialSegments:r,closed:i};let a=e.computeFrenetFrames(t,i);this.tangents=a.tangents,this.normals=a.normals,this.binormals=a.binormals;let o=new Q,s=new Q,c=new Z,l=new Q,u=[],d=[],f=[],p=[];m(),this.setIndex(p),this.setAttribute(`position`,new jd(u,3)),this.setAttribute(`normal`,new jd(d,3)),this.setAttribute(`uv`,new jd(f,2));function m(){for(let e=0;e<t;e++)h(e);h(i===!1?t:0),_(),g()}function h(i){l=e.getPointAt(i/t,l);let c=a.normals[i],f=a.binormals[i];for(let e=0;e<=r;e++){let t=e/r*Math.PI*2,i=Math.sin(t),a=-Math.cos(t);s.x=a*c.x+i*f.x,s.y=a*c.y+i*f.y,s.z=a*c.z+i*f.z,s.normalize(),d.push(s.x,s.y,s.z),o.x=l.x+n*s.x,o.y=l.y+n*s.y,o.z=l.z+n*s.z,u.push(o.x,o.y,o.z)}}function g(){for(let e=1;e<=t;e++)for(let t=1;t<=r;t++){let n=(r+1)*(e-1)+(t-1),i=(r+1)*e+(t-1),a=(r+1)*e+t,o=(r+1)*(e-1)+t;p.push(n,i,o),p.push(i,a,o)}}function _(){for(let e=0;e<=t;e++)for(let n=0;n<=r;n++)c.x=e/t,c.y=n/r,f.push(c.x,c.y)}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){let e=super.toJSON();return e.path=this.parameters.path.toJSON(),e}static fromJSON(t){return new e(new Cp[t.path.type]().fromJSON(t.path),t.tubularSegments,t.radius,t.radialSegments,t.closed)}};function Op(e){let t={};for(let n in e){t[n]={};for(let r in e[n]){let i=e[n][r];if(Ap(i))i.isRenderTargetTexture?(X(`UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms().`),t[n][r]=null):t[n][r]=i.clone();else if(Array.isArray(i))if(Ap(i[0])){let e=[];for(let t=0,n=i.length;t<n;t++)e[t]=i[t].clone();t[n][r]=e}else t[n][r]=i.slice();else t[n][r]=i}}return t}function kp(e){let t={};for(let n=0;n<e.length;n++){let r=Op(e[n]);for(let e in r)t[e]=r[e]}return t}function Ap(e){return e&&(e.isColor||e.isMatrix3||e.isMatrix4||e.isVector2||e.isVector3||e.isVector4||e.isTexture||e.isQuaternion)}function jp(e){let t=[];for(let n=0;n<e.length;n++)t.push(e[n].clone());return t}function Mp(e){let t=e.getRenderTarget();return t===null?e.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:Yl.workingColorSpace}var Np={clone:Op,merge:kp},Pp=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Fp=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,Ip=class extends Gd{constructor(e){super(),this.isShaderMaterial=!0,this.type=`ShaderMaterial`,this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Pp,this.fragmentShader=Fp,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Op(e.uniforms),this.uniformsGroups=jp(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let n in this.uniforms){let r=this.uniforms[n].value;r&&r.isTexture?t.uniforms[n]={type:`t`,value:r.toJSON(e).uuid}:r&&r.isColor?t.uniforms[n]={type:`c`,value:r.getHex()}:r&&r.isVector2?t.uniforms[n]={type:`v2`,value:r.toArray()}:r&&r.isVector3?t.uniforms[n]={type:`v3`,value:r.toArray()}:r&&r.isVector4?t.uniforms[n]={type:`v4`,value:r.toArray()}:r&&r.isMatrix3?t.uniforms[n]={type:`m3`,value:r.toArray()}:r&&r.isMatrix4?t.uniforms[n]={type:`m4`,value:r.toArray()}:t.uniforms[n]={value:r}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let e in this.extensions)this.extensions[e]===!0&&(n[e]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}fromJSON(e,t){if(super.fromJSON(e,t),e.uniforms!==void 0)for(let n in e.uniforms){let r=e.uniforms[n];switch(this.uniforms[n]={},r.type){case`t`:this.uniforms[n].value=t[r.value]||null;break;case`c`:this.uniforms[n].value=new Ku().setHex(r.value);break;case`v2`:this.uniforms[n].value=new Z().fromArray(r.value);break;case`v3`:this.uniforms[n].value=new Q().fromArray(r.value);break;case`v4`:this.uniforms[n].value=new ou().fromArray(r.value);break;case`m3`:this.uniforms[n].value=new Wl().fromArray(r.value);break;case`m4`:this.uniforms[n].value=new du().fromArray(r.value);break;default:this.uniforms[n].value=r.value}}if(e.defines!==void 0&&(this.defines=e.defines),e.vertexShader!==void 0&&(this.vertexShader=e.vertexShader),e.fragmentShader!==void 0&&(this.fragmentShader=e.fragmentShader),e.glslVersion!==void 0&&(this.glslVersion=e.glslVersion),e.extensions!==void 0)for(let t in e.extensions)this.extensions[t]=e.extensions[t];return e.lights!==void 0&&(this.lights=e.lights),e.clipping!==void 0&&(this.clipping=e.clipping),this}},Lp=class extends Ip{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type=`RawShaderMaterial`}},Rp=class extends Gd{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type=`MeshStandardMaterial`,this.defines={STANDARD:``},this.color=new Ku(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ku(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new Z(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new xu,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:``},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},zp=class extends Rp{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:``,PHYSICAL:``},this.type=`MeshPhysicalMaterial`,this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new Z(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return yl(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(e){this.ior=(1+.4*e)/(1-.4*e)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Ku(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Ku(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Ku(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:``,PHYSICAL:``},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}},Bp=class extends Gd{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type=`MeshDepthMaterial`,this.depthPacking=qc,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Vp=class extends Gd{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type=`MeshDistanceMaterial`,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function Hp(e,t){return!e||e.constructor===t?e:typeof t.BYTES_PER_ELEMENT==`number`?new t(e):Array.prototype.slice.call(e)}var Up=class{constructor(e,t,n,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r===void 0?new t.constructor(n):r,this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,r=t[n],i=t[n-1];validate_interval:{seek:{let a;linear_scan:{forward_scan:if(!(e<r)){for(let a=n+2;;){if(r===void 0){if(e<i)break forward_scan;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(i=r,r=t[++n],e<r)break seek}a=t.length;break linear_scan}if(!(e>=i)){let o=t[1];e<o&&(n=2,i=o);for(let a=n-2;;){if(i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===a)break;if(r=i,i=t[--n-1],e>=i)break seek}a=n,n=0;break linear_scan}break validate_interval}for(;n<a;){let r=n+a>>>1;e<t[r]?a=r:n=r+1}if(r=t[n],i=t[n-1],i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,i,r)}return this.interpolate_(n,i,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,r=this.valueSize,i=e*r;for(let e=0;e!==r;++e)t[e]=n[i+e];return t}interpolate_(){throw Error(`THREE.Interpolant: Call to abstract method.`)}intervalChanged_(){}},Wp=class extends Up{constructor(e,t,n,r){super(e,t,n,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Wc,endingEnd:Wc}}intervalChanged_(e,t,n){let r=this.parameterPositions,i=e-2,a=e+1,o=r[i],s=r[a];if(o===void 0)switch(this.getSettings_().endingStart){case Gc:i=e,o=2*t-n;break;case Kc:i=r.length-2,o=t+r[i]-r[i+1];break;default:i=e,o=n}if(s===void 0)switch(this.getSettings_().endingEnd){case Gc:a=e,s=2*n-t;break;case Kc:a=1,s=n+r[1]-r[0];break;default:a=e-1,s=t}let c=(n-t)*.5,l=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(s-n),this._offsetPrev=i*l,this._offsetNext=a*l}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,p=(n-t)/(r-t),m=p*p,h=m*p,g=-d*h+2*d*m-d*p,_=(1+d)*h+(-1.5-2*d)*m+(-.5+d)*p+1,v=(-1-f)*h+(1.5+f)*m+.5*p,y=f*h-f*m;for(let e=0;e!==o;++e)i[e]=g*a[l+e]+_*a[c+e]+v*a[s+e]+y*a[u+e];return i}},Gp=class extends Up{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=(n-t)/(r-t),u=1-l;for(let e=0;e!==o;++e)i[e]=a[c+e]*u+a[s+e]*l;return i}},Kp=class extends Up{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e){return this.copySampleValue_(e-1)}},qp=class extends Up{interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=this.inTangents,u=this.outTangents;if(!l||!u){let e=(n-t)/(r-t),l=1-e;for(let t=0;t!==o;++t)i[t]=a[c+t]*l+a[s+t]*e;return i}let d=o*2,f=e-1;for(let p=0;p!==o;++p){let o=a[c+p],m=a[s+p],h=f*d+p*2,g=u[h],_=u[h+1],v=e*d+p*2,y=l[v],b=l[v+1],x=(n-t)/(r-t),S,C,w,T,E;for(let e=0;e<8;e++){S=x*x,C=S*x,w=1-x,T=w*w,E=T*w;let e=E*t+3*T*x*g+3*w*S*y+C*r-n;if(Math.abs(e)<1e-10)break;let i=3*T*(g-t)+6*w*x*(y-g)+3*S*(r-y);if(Math.abs(i)<1e-10)break;x-=e/i,x=Math.max(0,Math.min(1,x))}i[p]=E*o+3*T*x*_+3*w*S*b+C*m}return i}},Jp=class{constructor(e,t,n,r){if(e===void 0)throw Error(`THREE.KeyframeTrack: track name is undefined`);if(t===void 0||t.length===0)throw Error(`THREE.KeyframeTrack: no keyframes in track named `+e);this.name=e,this.times=Hp(t,this.TimeBufferType),this.values=Hp(n,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Hp(e.times,Array),values:Hp(e.values,Array)};let t=e.getInterpolation();t!==e.DefaultInterpolation&&(n.interpolation=t)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Kp(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Gp(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Wp(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new qp(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.inTangents=this.settings.inTangents,t.outTangents=this.settings.outTangents),t}setInterpolation(e){let t;switch(e){case Bc:t=this.InterpolantFactoryMethodDiscrete;break;case Vc:t=this.InterpolantFactoryMethodLinear;break;case Hc:t=this.InterpolantFactoryMethodSmooth;break;case Uc:t=this.InterpolantFactoryMethodBezier;break}if(t===void 0){let t=`unsupported interpolation for `+this.ValueTypeName+` keyframe track named `+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw Error(t);return X(`KeyframeTrack:`,t),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Bc;case this.InterpolantFactoryMethodLinear:return Vc;case this.InterpolantFactoryMethodSmooth:return Hc;case this.InterpolantFactoryMethodBezier:return Uc}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]*=e}return this}trim(e,t){let n=this.times,r=n.length,i=0,a=r-1;for(;i!==r&&n[i]<e;)++i;for(;a!==-1&&n[a]>t;)--a;if(++a,i!==0||a!==r){i>=a&&(a=Math.max(a,1),i=a-1);let e=this.getValueSize();this.times=n.slice(i,a),this.values=this.values.slice(i*e,a*e)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(ll(`KeyframeTrack: Invalid value size in track.`,this),e=!1);let n=this.times,r=this.values,i=n.length;i===0&&(ll(`KeyframeTrack: Track is empty.`,this),e=!1);let a=null;for(let t=0;t!==i;t++){let r=n[t];if(typeof r==`number`&&isNaN(r)){ll(`KeyframeTrack: Time is not a valid number.`,this,t,r),e=!1;break}if(a!==null&&a>r){ll(`KeyframeTrack: Out of order keys.`,this,t,r,a),e=!1;break}a=r}if(r!==void 0&&rl(r))for(let t=0,n=r.length;t!==n;++t){let n=r[t];if(isNaN(n)){ll(`KeyframeTrack: Value is not a valid number.`,this,t,n),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),r=this.getInterpolation()===Hc,i=e.length-1,a=1;for(let o=1;o<i;++o){let i=!1,s=e[o];if(s!==e[o+1]&&(o!==1||s!==e[0]))if(r)i=!0;else{let e=o*n,r=e-n,a=e+n;for(let o=0;o!==n;++o){let n=t[e+o];if(n!==t[r+o]||n!==t[a+o]){i=!0;break}}}if(i){if(o!==a){e[a]=e[o];let r=o*n,i=a*n;for(let e=0;e!==n;++e)t[i+e]=t[r+e]}++a}}if(i>0){e[a]=e[i];for(let e=i*n,r=a*n,o=0;o!==n;++o)t[r+o]=t[e+o];++a}return a===e.length?(this.times=e,this.values=t):(this.times=e.slice(0,a),this.values=t.slice(0,a*n)),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,r=new n(this.name,e,t);return r.createInterpolant=this.createInterpolant,r}};Jp.prototype.ValueTypeName=``,Jp.prototype.TimeBufferType=Float32Array,Jp.prototype.ValueBufferType=Float32Array,Jp.prototype.DefaultInterpolation=Vc;var Yp=class extends Jp{constructor(e,t,n){super(e,t,n)}};Yp.prototype.ValueTypeName=`bool`,Yp.prototype.ValueBufferType=Array,Yp.prototype.DefaultInterpolation=Bc,Yp.prototype.InterpolantFactoryMethodLinear=void 0,Yp.prototype.InterpolantFactoryMethodSmooth=void 0;var Xp=class extends Jp{constructor(e,t,n,r){super(e,t,n,r)}};Xp.prototype.ValueTypeName=`color`;var Zp=class extends Jp{constructor(e,t,n,r){super(e,t,n,r)}};Zp.prototype.ValueTypeName=`number`;var Qp=class extends Up{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=(n-t)/(r-t),c=e*o;for(let e=c+o;c!==e;c+=4)Vl.slerpFlat(i,0,a,c-o,a,c,s);return i}},$p=class extends Jp{constructor(e,t,n,r){super(e,t,n,r)}InterpolantFactoryMethodLinear(e){return new Qp(this.times,this.values,this.getValueSize(),e)}};$p.prototype.ValueTypeName=`quaternion`,$p.prototype.InterpolantFactoryMethodSmooth=void 0;var em=class extends Jp{constructor(e,t,n){super(e,t,n)}};em.prototype.ValueTypeName=`string`,em.prototype.ValueBufferType=Array,em.prototype.DefaultInterpolation=Bc,em.prototype.InterpolantFactoryMethodLinear=void 0,em.prototype.InterpolantFactoryMethodSmooth=void 0;var tm=class extends Jp{constructor(e,t,n,r){super(e,t,n,r)}};tm.prototype.ValueTypeName=`vector`;var nm=new class{constructor(e,t,n){let r=this,i=!1,a=0,o=0,s,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this._abortController=null,this.itemStart=function(e){o++,i===!1&&r.onStart!==void 0&&r.onStart(e,a,o),i=!0},this.itemEnd=function(e){a++,r.onProgress!==void 0&&r.onProgress(e,a,o),a===o&&(i=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(e){r.onError!==void 0&&r.onError(e)},this.resolveURL=function(e){return e=e.normalize(`NFC`),s?s(e):e},this.setURLModifier=function(e){return s=e,this},this.addHandler=function(e,t){return c.push(e,t),this},this.removeHandler=function(e){let t=c.indexOf(e);return t!==-1&&c.splice(t,2),this},this.getHandler=function(e){for(let t=0,n=c.length;t<n;t+=2){let n=c[t],r=c[t+1];if(n.global&&(n.lastIndex=0),n.test(e))return r}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||=new AbortController,this._abortController}},rm=class{constructor(e){this.manager=e===void 0?nm:e,this.crossOrigin=`anonymous`,this.withCredentials=!1,this.path=``,this.resourcePath=``,this.requestHeader={},typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}load(){}loadAsync(e,t){let n=this;return new Promise(function(r,i){n.load(e,r,t,i)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};rm.DEFAULT_MATERIAL_NAME=`__DEFAULT`;var im=class extends Ru{constructor(e,t=1){super(),this.isLight=!0,this.type=`Light`,this.color=new Ku(e),this.intensity=t}dispose(){this.dispatchEvent({type:`dispose`})}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},am=class extends im{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type=`HemisphereLight`,this.position.copy(Ru.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ku(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},om=new du,sm=new Q,cm=new Q,lm=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Z(512,512),this.mapType=Fs,this.map=null,this.mapPass=null,this.matrix=new du,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Nf,this._frameExtents=new Z(1,1),this._viewportCount=1,this._viewports=[new ou(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,n=this.matrix;sm.setFromMatrixPosition(e.matrixWorld),t.position.copy(sm),cm.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(cm),t.updateMatrixWorld(),om.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(om,t.coordinateSystem,t.reversedDepth),t.coordinateSystem===2001||t.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(om)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},um=new Q,dm=new Vl,fm=new Q,pm=class extends Ru{constructor(){super(),this.isCamera=!0,this.type=`Camera`,this.matrixWorldInverse=new du,this.projectionMatrix=new du,this.projectionMatrixInverse=new du,this.coordinateSystem=tl,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(um,dm,fm),fm.x===1&&fm.y===1&&fm.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(um,dm,fm.set(1,1,1)).invert()}updateWorldMatrix(e,t,n=!1){super.updateWorldMatrix(e,t,n),this.matrixWorld.decompose(um,dm,fm),fm.x===1&&fm.y===1&&fm.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(um,dm,fm.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},mm=new Q,hm=new Z,gm=new Z,_m=class extends pm{constructor(e=50,t=1,n=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type=`PerspectiveCamera`,this.fov=e,this.zoom=1,this.near=n,this.far=r,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=_l*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(gl*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return _l*2*Math.atan(Math.tan(gl*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){mm.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(mm.x,mm.y).multiplyScalar(-e/mm.z),mm.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(mm.x,mm.y).multiplyScalar(-e/mm.z)}getViewSize(e,t){return this.getViewBounds(e,hm,gm),t.subVectors(gm,hm)}setViewOffset(e,t,n,r,i,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=i,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(gl*.5*this.fov)/this.zoom,n=2*t,r=this.aspect*n,i=-.5*r,a=this.view;if(this.view!==null&&this.view.enabled){let e=a.fullWidth,o=a.fullHeight;i+=a.offsetX*r/e,t-=a.offsetY*n/o,r*=a.width/e,n*=a.height/o}let o=this.filmOffset;o!==0&&(i+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(i,i+r,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},vm=class extends lm{constructor(){super(new _m(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){let t=this.camera,n=_l*2*e.angle*this.focus,r=this.mapSize.width/this.mapSize.height*this.aspect,i=e.distance||t.far;(n!==t.fov||r!==t.aspect||i!==t.far)&&(t.fov=n,t.aspect=r,t.far=i,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}},ym=class extends im{constructor(e,t,n=0,r=Math.PI/3,i=0,a=2){super(e,t),this.isSpotLight=!0,this.type=`SpotLight`,this.position.copy(Ru.DEFAULT_UP),this.updateMatrix(),this.target=new Ru,this.distance=n,this.angle=r,this.penumbra=i,this.decay=a,this.map=null,this.shadow=new vm}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.map=e.map,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.angle=this.angle,t.object.decay=this.decay,t.object.penumbra=this.penumbra,t.object.target=this.target.uuid,this.map&&this.map.isTexture&&(t.object.map=this.map.toJSON(e).uuid),t.object.shadow=this.shadow.toJSON(),t}},bm=class extends pm{constructor(e=-1,t=1,n=1,r=-1,i=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type=`OrthographicCamera`,this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=r,this.near=i,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,r,i,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=i,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,r=(this.top+this.bottom)/2,i=n-e,a=n+e,o=r+t,s=r-t;if(this.view!==null&&this.view.enabled){let e=(this.right-this.left)/this.view.fullWidth/this.zoom,t=(this.top-this.bottom)/this.view.fullHeight/this.zoom;i+=e*this.view.offsetX,a=i+e*this.view.width,o-=t*this.view.offsetY,s=o-t*this.view.height}this.projectionMatrix.makeOrthographic(i,a,o,s,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},xm=class extends lm{constructor(){super(new bm(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Sm=class extends im{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type=`DirectionalLight`,this.position.copy(Ru.DEFAULT_UP),this.updateMatrix(),this.target=new Ru,this.shadow=new xm}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}},Cm=class extends im{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type=`AmbientLight`}},wm=-90,Tm=1,Em=class extends Ru{constructor(e,t,n){super(),this.type=`CubeCamera`,this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new _m(wm,Tm,e,t);r.layers=this.layers,this.add(r);let i=new _m(wm,Tm,e,t);i.layers=this.layers,this.add(i);let a=new _m(wm,Tm,e,t);a.layers=this.layers,this.add(a);let o=new _m(wm,Tm,e,t);o.layers=this.layers,this.add(o);let s=new _m(wm,Tm,e,t);s.layers=this.layers,this.add(s);let c=new _m(wm,Tm,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,r,i,a,o,s]=t;for(let e of t)this.remove(e);if(e===2e3)n.up.set(0,1,0),n.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),i.up.set(0,0,-1),i.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),s.up.set(0,1,0),s.lookAt(0,0,-1);else if(e===2001)n.up.set(0,-1,0),n.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),i.up.set(0,0,1),i.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),s.up.set(0,-1,0),s.lookAt(0,0,-1);else throw Error(`THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: `+e);for(let e of t)this.add(e),e.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[i,a,o,s,c,l]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),p=e.xr.enabled;e.xr.enabled=!1;let m=n.texture.generateMipmaps;n.texture.generateMipmaps=!1;let h=!1;h=e.isWebGLRenderer===!0?e.state.buffers.depth.getReversed():e.reversedDepthBuffer,e.setRenderTarget(n,0,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,i),e.setRenderTarget(n,1,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(n,2,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,o),e.setRenderTarget(n,3,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,s),e.setRenderTarget(n,4,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,c),n.texture.generateMipmaps=m,e.setRenderTarget(n,5,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),e.setRenderTarget(u,d,f),e.xr.enabled=p,n.texture.needsPMREMUpdate=!0}},Dm=class extends _m{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}},Om=class{constructor(){this._previousTime=0,this._currentTime=0,this._startTime=performance.now(),this._delta=0,this._elapsed=0,this._timescale=1,this._document=null,this._pageVisibilityHandler=null}connect(e){this._document=e,e.hidden!==void 0&&(this._pageVisibilityHandler=km.bind(this),e.addEventListener(`visibilitychange`,this._pageVisibilityHandler,!1))}disconnect(){this._pageVisibilityHandler!==null&&(this._document.removeEventListener(`visibilitychange`,this._pageVisibilityHandler),this._pageVisibilityHandler=null),this._document=null}getDelta(){return this._delta/1e3}getElapsed(){return this._elapsed/1e3}getTimescale(){return this._timescale}setTimescale(e){return this._timescale=e,this}reset(){return this._currentTime=performance.now()-this._startTime,this}dispose(){this.disconnect()}update(e){return this._pageVisibilityHandler!==null&&this._document.hidden===!0?this._delta=0:(this._previousTime=this._currentTime,this._currentTime=(e===void 0?performance.now():e)-this._startTime,this._delta=(this._currentTime-this._previousTime)*this._timescale,this._elapsed+=this._delta),this}};function km(){this._document.hidden===!1&&this.reset()}var Am=`\\[\\]\\.:\\/`,jm=RegExp(`[\\[\\]\\.:\\/]`,`g`),Mm=`[^\\[\\]\\.:\\/]`,Nm=`[^`+Am.replace(`\\.`,``)+`]`,Pm=`((?:WC+[\\/:])*)`.replace(`WC`,Mm),Fm=`(WCOD+)?`.replace(`WCOD`,Nm),Im=`(?:\\.(WC+)(?:\\[(.+)\\])?)?`.replace(`WC`,Mm),Lm=`\\.(WC+)(?:\\[(.+)\\])?`.replace(`WC`,Mm),Rm=RegExp(`^`+Pm+Fm+Im+Lm+`$`),zm=[`material`,`materials`,`bones`,`map`],Bm=class{constructor(e,t,n){let r=n||Vm.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,r)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,r=this._bindings[n];r!==void 0&&r.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let r=this._targetGroup.nCachedObjects_,i=n.length;r!==i;++r)n[r].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},Vm=class e{constructor(t,n,r){this.path=n,this.parsedPath=r||e.parseTrackName(n),this.node=e.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,n,r){return t&&t.isAnimationObjectGroup?new e.Composite(t,n,r):new e(t,n,r)}static sanitizeNodeName(e){return e.replace(/\s/g,`_`).replace(jm,``)}static parseTrackName(e){let t=Rm.exec(e);if(t===null)throw Error(`THREE.PropertyBinding: Cannot parse trackName: `+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},r=n.nodeName&&n.nodeName.lastIndexOf(`.`);if(r!==void 0&&r!==-1){let e=n.nodeName.substring(r+1);zm.indexOf(e)!==-1&&(n.nodeName=n.nodeName.substring(0,r),n.objectName=e)}if(n.propertyName===null||n.propertyName.length===0)throw Error(`THREE.PropertyBinding: can not parse propertyName from trackName: `+e);return n}static findNode(e,t){if(t===void 0||t===``||t===`.`||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(e){for(let r=0;r<e.length;r++){let i=e[r];if(i.name===t||i.uuid===t)return i;let a=n(i.children);if(a)return a}return null},r=n(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)e[t++]=n[r]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let t=this.node,n=this.parsedPath,r=n.objectName,i=n.propertyName,a=n.propertyIndex;if(t||(t=e.findNode(this.rootNode,n.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){X(`PropertyBinding: No target node found for track: `+this.path+`.`);return}if(r){let e=n.objectIndex;switch(r){case`materials`:if(!t.material){ll(`PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.materials){ll(`PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.`,this);return}t=t.material.materials;break;case`bones`:if(!t.skeleton){ll(`PropertyBinding: Can not bind to bones as node does not have a skeleton.`,this);return}t=t.skeleton.bones;for(let n=0;n<t.length;n++)if(t[n].name===e){e=n;break}break;case`map`:if(`map`in t){t=t.map;break}if(!t.material){ll(`PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.map){ll(`PropertyBinding: Can not bind to material.map as node.material does not have a map.`,this);return}t=t.material.map;break;default:if(t[r]===void 0){ll(`PropertyBinding: Can not bind to objectName of node undefined.`,this);return}t=t[r]}if(e!==void 0){if(t[e]===void 0){ll(`PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.`,this,t);return}t=t[e]}}let o=t[i];if(o===void 0){let e=n.nodeName;ll(`PropertyBinding: Trying to update property for track: `+e+`.`+i+` but it wasn't found.`,t);return}let s=this.Versioning.None;this.targetObject=t,t.isMaterial===!0?s=this.Versioning.NeedsUpdate:t.isObject3D===!0&&(s=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(a!==void 0){if(i===`morphTargetInfluences`){if(!t.geometry){ll(`PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.`,this);return}if(!t.geometry.morphAttributes){ll(`PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.`,this);return}t.morphTargetDictionary[a]!==void 0&&(a=t.morphTargetDictionary[a])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=a}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=i;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][s]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};Vm.Composite=Bm,Vm.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3},Vm.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2},Vm.prototype.GetterByBindingType=[Vm.prototype._getValue_direct,Vm.prototype._getValue_array,Vm.prototype._getValue_arrayElement,Vm.prototype._getValue_toArray],Vm.prototype.SetterByBindingTypeAndVersioning=[[Vm.prototype._setValue_direct,Vm.prototype._setValue_direct_setNeedsUpdate,Vm.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Vm.prototype._setValue_array,Vm.prototype._setValue_array_setNeedsUpdate,Vm.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Vm.prototype._setValue_arrayElement,Vm.prototype._setValue_arrayElement_setNeedsUpdate,Vm.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Vm.prototype._setValue_fromArray,Vm.prototype._setValue_fromArray_setNeedsUpdate,Vm.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]],class e{static{e.prototype.isMatrix2=!0}constructor(e,t,n,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,r){let i=this.elements;return i[0]=e,i[2]=t,i[1]=n,i[3]=r,this}};function Hm(e,t,n,r){let i=Um(r);switch(n){case Js:return e*t;case $s:return e*t/i.components*i.byteLength;case ec:return e*t/i.components*i.byteLength;case tc:return e*t*2/i.components*i.byteLength;case nc:return e*t*2/i.components*i.byteLength;case Ys:return e*t*3/i.components*i.byteLength;case Xs:return e*t*4/i.components*i.byteLength;case rc:return e*t*4/i.components*i.byteLength;case ic:case ac:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case oc:case sc:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case lc:case dc:return Math.max(e,16)*Math.max(t,8)/4;case cc:case uc:return Math.max(e,8)*Math.max(t,8)/2;case fc:case pc:case hc:case gc:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case mc:case _c:case vc:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case yc:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case bc:return Math.floor((e+4)/5)*Math.floor((t+3)/4)*16;case xc:return Math.floor((e+4)/5)*Math.floor((t+4)/5)*16;case Sc:return Math.floor((e+5)/6)*Math.floor((t+4)/5)*16;case Cc:return Math.floor((e+5)/6)*Math.floor((t+5)/6)*16;case wc:return Math.floor((e+7)/8)*Math.floor((t+4)/5)*16;case Tc:return Math.floor((e+7)/8)*Math.floor((t+5)/6)*16;case Ec:return Math.floor((e+7)/8)*Math.floor((t+7)/8)*16;case Dc:return Math.floor((e+9)/10)*Math.floor((t+4)/5)*16;case Oc:return Math.floor((e+9)/10)*Math.floor((t+5)/6)*16;case kc:return Math.floor((e+9)/10)*Math.floor((t+7)/8)*16;case Ac:return Math.floor((e+9)/10)*Math.floor((t+9)/10)*16;case jc:return Math.floor((e+11)/12)*Math.floor((t+9)/10)*16;case Mc:return Math.floor((e+11)/12)*Math.floor((t+11)/12)*16;case Nc:case Pc:case Fc:return Math.ceil(e/4)*Math.ceil(t/4)*16;case Ic:case Lc:return Math.ceil(e/4)*Math.ceil(t/4)*8;case Rc:case zc:return Math.ceil(e/4)*Math.ceil(t/4)*16}throw Error(`Unable to determine texture byte length for ${n} format.`)}function Um(e){switch(e){case Fs:case Is:return{byteLength:1,components:1};case Rs:case Ls:case Hs:return{byteLength:2,components:1};case Us:case Ws:return{byteLength:2,components:4};case Bs:case zs:case Vs:return{byteLength:4,components:1};case Ks:case qs:return{byteLength:4,components:3}}throw Error(`THREE.TextureUtils: Unknown texture type ${e}.`)}typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`register`,{detail:{revision:`185`}})),typeof window<`u`&&(window.__THREE__?X(`WARNING: Multiple instances of Three.js being imported.`):window.__THREE__=`185`);function Wm(){let e=null,t=!1,n=null,r=null;function i(t,a){n(t,a),r=e.requestAnimationFrame(i)}return{start:function(){t!==!0&&n!==null&&e!==null&&(r=e.requestAnimationFrame(i),t=!0)},stop:function(){e!==null&&e.cancelAnimationFrame(r),t=!1},setAnimationLoop:function(e){n=e},setContext:function(t){e=t}}}function Gm(e){let t=new WeakMap;function n(t,n){let r=t.array,i=t.usage,a=r.byteLength,o=e.createBuffer();e.bindBuffer(n,o),e.bufferData(n,r,i),t.onUploadCallback();let s;if(r instanceof Float32Array)s=e.FLOAT;else if(typeof Float16Array<`u`&&r instanceof Float16Array)s=e.HALF_FLOAT;else if(r instanceof Uint16Array)s=t.isFloat16BufferAttribute?e.HALF_FLOAT:e.UNSIGNED_SHORT;else if(r instanceof Int16Array)s=e.SHORT;else if(r instanceof Uint32Array)s=e.UNSIGNED_INT;else if(r instanceof Int32Array)s=e.INT;else if(r instanceof Int8Array)s=e.BYTE;else if(r instanceof Uint8Array)s=e.UNSIGNED_BYTE;else if(r instanceof Uint8ClampedArray)s=e.UNSIGNED_BYTE;else throw Error(`THREE.WebGLAttributes: Unsupported buffer data format: `+r);return{buffer:o,type:s,bytesPerElement:r.BYTES_PER_ELEMENT,version:t.version,size:a}}function r(t,n,r){let i=n.array,a=n.updateRanges;if(e.bindBuffer(r,t),a.length===0)e.bufferSubData(r,0,i);else{a.sort((e,t)=>e.start-t.start);let t=0;for(let e=1;e<a.length;e++){let n=a[t],r=a[e];r.start<=n.start+n.count+1?n.count=Math.max(n.count,r.start+r.count-n.start):(++t,a[t]=r)}a.length=t+1;for(let t=0,n=a.length;t<n;t++){let n=a[t];e.bufferSubData(r,n.start*i.BYTES_PER_ELEMENT,i,n.start,n.count)}n.clearUpdateRanges()}n.onUploadCallback()}function i(e){return e.isInterleavedBufferAttribute&&(e=e.data),t.get(e)}function a(n){n.isInterleavedBufferAttribute&&(n=n.data);let r=t.get(n);r&&(e.deleteBuffer(r.buffer),t.delete(n))}function o(e,i){if(e.isInterleavedBufferAttribute&&(e=e.data),e.isGLBufferAttribute){let n=t.get(e);(!n||n.version<e.version)&&t.set(e,{buffer:e.buffer,type:e.type,bytesPerElement:e.elementSize,version:e.version});return}let a=t.get(e);if(a===void 0)t.set(e,n(e,i));else if(a.version<e.version){if(a.size!==e.array.byteLength)throw Error(`THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.`);r(a.buffer,e,i),a.version=e.version}}return{get:i,remove:a,update:o}}var Km={alphahash_fragment:`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,alphahash_pars_fragment:`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,alphamap_fragment:`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,alphamap_pars_fragment:`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,alphatest_fragment:`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,alphatest_pars_fragment:`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,aomap_fragment:`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,aomap_pars_fragment:`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,batching_pars_vertex:`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,batching_vertex:`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,begin_vertex:`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,beginnormal_vertex:`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bsdfs:`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,iridescence_fragment:`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,bumpmap_pars_fragment:`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,clipping_planes_fragment:`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,clipping_planes_pars_fragment:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,clipping_planes_pars_vertex:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,clipping_planes_vertex:`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,color_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,color_pars_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,color_pars_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,color_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,common:`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,cube_uv_reflection_fragment:`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,defaultnormal_vertex:`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,displacementmap_pars_vertex:`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,displacementmap_vertex:`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,emissivemap_fragment:`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,emissivemap_pars_fragment:`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,colorspace_fragment:`gl_FragColor = linearToOutputTexel( gl_FragColor );`,colorspace_pars_fragment:`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,envmap_fragment:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,envmap_common_pars_fragment:`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,envmap_pars_fragment:`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,envmap_pars_vertex:`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,envmap_physical_pars_fragment:`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,envmap_vertex:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,fog_vertex:`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,fog_pars_vertex:`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,fog_fragment:`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,fog_pars_fragment:`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,gradientmap_pars_fragment:`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,lightmap_pars_fragment:`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,lights_lambert_fragment:`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,lights_lambert_pars_fragment:`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,lights_pars_begin:`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,lights_toon_fragment:`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lights_toon_pars_fragment:`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,lights_phong_fragment:`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,lights_phong_pars_fragment:`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,lights_physical_fragment:`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,lights_physical_pars_fragment:`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
		vec3 iridescenceFresnelDielectric;
		vec3 iridescenceFresnelMetallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
vec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 dfgV = texture2D( dfgLUT, vec2( material.roughness, dotNV ) ).rg;
	vec2 dfgL = texture2D( dfgLUT, vec2( material.roughness, dotNL ) ).rg;
	vec3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;
	vec3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;
	float Ess_V = dfgV.x + dfgV.y;
	float Ess_L = dfgL.x + dfgL.y;
	float Ems_V = 1.0 - Ess_V;
	float Ems_L = 1.0 - Ess_L;
	vec3 Favg = material.specularColorBlended + ( 1.0 - material.specularColorBlended ) * 0.047619;
	vec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg + EPSILON );
	float compensationFactor = Ems_V * Ems_L;
	vec3 multiScatter = Fms * compensationFactor;
	return singleScatter + multiScatter;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnelDielectric, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceFresnelMetallic, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,lights_fragment_begin:`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( material.iridescenceFresnelDielectric, material.iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,lights_fragment_maps:`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,lights_fragment_end:`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,lightprobes_pars_fragment:`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,logdepthbuf_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,logdepthbuf_pars_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_pars_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,map_fragment:`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,map_pars_fragment:`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,map_particle_fragment:`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,map_particle_pars_fragment:`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,metalnessmap_fragment:`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,metalnessmap_pars_fragment:`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,morphinstance_vertex:`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,morphcolor_vertex:`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,morphnormal_vertex:`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,morphtarget_pars_vertex:`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,morphtarget_vertex:`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,normal_fragment_begin:`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,normal_fragment_maps:`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,normal_pars_fragment:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_pars_vertex:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_vertex:`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,normalmap_pars_fragment:`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,clearcoat_normal_fragment_begin:`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,clearcoat_normal_fragment_maps:`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,clearcoat_pars_fragment:`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,iridescence_pars_fragment:`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,opaque_fragment:`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,packing:`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,premultiplied_alpha_fragment:`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,project_vertex:`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,dithering_fragment:`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,dithering_pars_fragment:`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,roughnessmap_fragment:`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,roughnessmap_pars_fragment:`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,shadowmap_pars_fragment:`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,shadowmap_pars_vertex:`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,shadowmap_vertex:`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,shadowmask_pars_fragment:`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,skinbase_vertex:`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,skinning_pars_vertex:`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,skinning_vertex:`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,skinnormal_vertex:`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,specularmap_fragment:`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,specularmap_pars_fragment:`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,tonemapping_fragment:`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,tonemapping_pars_fragment:`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,transmission_fragment:`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,transmission_pars_fragment:`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,uv_pars_fragment:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_pars_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,uv_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,worldpos_vertex:`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,background_vert:`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,background_frag:`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,backgroundCube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,backgroundCube_frag:`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,cube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,cube_frag:`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,depth_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,depth_frag:`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,distance_vert:`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,distance_frag:`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,equirect_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,equirect_frag:`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,linedashed_vert:`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,linedashed_frag:`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,meshbasic_vert:`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,meshbasic_frag:`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshlambert_vert:`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshlambert_frag:`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshmatcap_vert:`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,meshmatcap_frag:`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshnormal_vert:`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,meshnormal_frag:`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,meshphong_vert:`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshphong_frag:`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshphysical_vert:`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,meshphysical_frag:`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,meshtoon_vert:`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,meshtoon_frag:`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,points_vert:`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,points_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,shadow_vert:`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,shadow_frag:`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,sprite_vert:`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,sprite_frag:`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`},$={common:{diffuse:{value:new Ku(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Wl},alphaMap:{value:null},alphaMapTransform:{value:new Wl},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Wl}},envmap:{envMap:{value:null},envMapRotation:{value:new Wl},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Wl}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Wl}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Wl},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Wl},normalScale:{value:new Z(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Wl},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Wl}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Wl}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Wl}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ku(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new Q},probesMax:{value:new Q},probesResolution:{value:new Q}},points:{diffuse:{value:new Ku(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Wl},alphaTest:{value:0},uvTransform:{value:new Wl}},sprite:{diffuse:{value:new Ku(16777215)},opacity:{value:1},center:{value:new Z(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Wl},alphaMap:{value:null},alphaMapTransform:{value:new Wl},alphaTest:{value:0}}},qm={basic:{uniforms:kp([$.common,$.specularmap,$.envmap,$.aomap,$.lightmap,$.fog]),vertexShader:Km.meshbasic_vert,fragmentShader:Km.meshbasic_frag},lambert:{uniforms:kp([$.common,$.specularmap,$.envmap,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.fog,$.lights,{emissive:{value:new Ku(0)},envMapIntensity:{value:1}}]),vertexShader:Km.meshlambert_vert,fragmentShader:Km.meshlambert_frag},phong:{uniforms:kp([$.common,$.specularmap,$.envmap,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.fog,$.lights,{emissive:{value:new Ku(0)},specular:{value:new Ku(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Km.meshphong_vert,fragmentShader:Km.meshphong_frag},standard:{uniforms:kp([$.common,$.envmap,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.roughnessmap,$.metalnessmap,$.fog,$.lights,{emissive:{value:new Ku(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Km.meshphysical_vert,fragmentShader:Km.meshphysical_frag},toon:{uniforms:kp([$.common,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.gradientmap,$.fog,$.lights,{emissive:{value:new Ku(0)}}]),vertexShader:Km.meshtoon_vert,fragmentShader:Km.meshtoon_frag},matcap:{uniforms:kp([$.common,$.bumpmap,$.normalmap,$.displacementmap,$.fog,{matcap:{value:null}}]),vertexShader:Km.meshmatcap_vert,fragmentShader:Km.meshmatcap_frag},points:{uniforms:kp([$.points,$.fog]),vertexShader:Km.points_vert,fragmentShader:Km.points_frag},dashed:{uniforms:kp([$.common,$.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Km.linedashed_vert,fragmentShader:Km.linedashed_frag},depth:{uniforms:kp([$.common,$.displacementmap]),vertexShader:Km.depth_vert,fragmentShader:Km.depth_frag},normal:{uniforms:kp([$.common,$.bumpmap,$.normalmap,$.displacementmap,{opacity:{value:1}}]),vertexShader:Km.meshnormal_vert,fragmentShader:Km.meshnormal_frag},sprite:{uniforms:kp([$.sprite,$.fog]),vertexShader:Km.sprite_vert,fragmentShader:Km.sprite_frag},background:{uniforms:{uvTransform:{value:new Wl},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Km.background_vert,fragmentShader:Km.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Wl}},vertexShader:Km.backgroundCube_vert,fragmentShader:Km.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Km.cube_vert,fragmentShader:Km.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Km.equirect_vert,fragmentShader:Km.equirect_frag},distance:{uniforms:kp([$.common,$.displacementmap,{referencePosition:{value:new Q},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Km.distance_vert,fragmentShader:Km.distance_frag},shadow:{uniforms:kp([$.lights,$.fog,{color:{value:new Ku(0)},opacity:{value:1}}]),vertexShader:Km.shadow_vert,fragmentShader:Km.shadow_frag}};qm.physical={uniforms:kp([qm.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Wl},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Wl},clearcoatNormalScale:{value:new Z(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Wl},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Wl},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Wl},sheen:{value:0},sheenColor:{value:new Ku(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Wl},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Wl},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Wl},transmissionSamplerSize:{value:new Z},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Wl},attenuationDistance:{value:0},attenuationColor:{value:new Ku(0)},specularColor:{value:new Ku(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Wl},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Wl},anisotropyVector:{value:new Z},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Wl}}]),vertexShader:Km.meshphysical_vert,fragmentShader:Km.meshphysical_frag};var Jm={r:0,b:0,g:0},Ym=new du,Xm=new Wl;Xm.set(-1,0,0,0,1,0,0,0,1);function Zm(e,t,n,r,i,a){let o=new Ku(0),s=i===!0?0:1,c,l,u=null,d=0,f=null;function p(e){let n=e.isScene===!0?e.background:null;if(n&&n.isTexture){let r=e.backgroundBlurriness>0;n=t.get(n,r)}return n}function m(t){let r=!1,i=p(t);i===null?g(o,s):i&&i.isColor&&(g(i,1),r=!0);let c=e.xr.getEnvironmentBlendMode();c===`additive`?n.buffers.color.setClear(0,0,0,1,a):c===`alpha-blend`&&n.buffers.color.setClear(0,0,0,0,a),(e.autoClear||r)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil))}function h(t,n){let i=p(n);i&&(i.isCubeTexture||i.mapping===306)?(l===void 0&&(l=new pf(new Kf(1,1,1),new Ip({name:`BackgroundCubeMaterial`,uniforms:Op(qm.backgroundCube.uniforms),vertexShader:qm.backgroundCube.vertexShader,fragmentShader:qm.backgroundCube.fragmentShader,side:1,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute(`normal`),l.geometry.deleteAttribute(`uv`),l.onBeforeRender=function(e,t,n){this.matrixWorld.copyPosition(n.matrixWorld)},Object.defineProperty(l.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),r.update(l)),l.material.uniforms.envMap.value=i,l.material.uniforms.backgroundBlurriness.value=n.backgroundBlurriness,l.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,l.material.uniforms.backgroundRotation.value.setFromMatrix4(Ym.makeRotationFromEuler(n.backgroundRotation)).transpose(),i.isCubeTexture&&i.isRenderTargetTexture===!1&&l.material.uniforms.backgroundRotation.value.premultiply(Xm),l.material.toneMapped=Yl.getTransfer(i.colorSpace)!==Zc,(u!==i||d!==i.version||f!==e.toneMapping)&&(l.material.needsUpdate=!0,u=i,d=i.version,f=e.toneMapping),l.layers.enableAll(),t.unshift(l,l.geometry,l.material,0,0,null)):i&&i.isTexture&&(c===void 0&&(c=new pf(new wp(2,2),new Ip({name:`BackgroundMaterial`,uniforms:Op(qm.background.uniforms),vertexShader:qm.background.vertexShader,fragmentShader:qm.background.fragmentShader,side:0,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute(`normal`),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),r.update(c)),c.material.uniforms.t2D.value=i,c.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,c.material.toneMapped=Yl.getTransfer(i.colorSpace)!==Zc,i.matrixAutoUpdate===!0&&i.updateMatrix(),c.material.uniforms.uvTransform.value.copy(i.matrix),(u!==i||d!==i.version||f!==e.toneMapping)&&(c.material.needsUpdate=!0,u=i,d=i.version,f=e.toneMapping),c.layers.enableAll(),t.unshift(c,c.geometry,c.material,0,0,null))}function g(t,r){t.getRGB(Jm,Mp(e)),n.buffers.color.setClear(Jm.r,Jm.g,Jm.b,r,a)}function _(){l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0),c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0)}return{getClearColor:function(){return o},setClearColor:function(e,t=1){o.set(e),s=t,g(o,s)},getClearAlpha:function(){return s},setClearAlpha:function(e){s=e,g(o,s)},render:m,addToRenderList:h,dispose:_}}function Qm(e,t){let n=e.getParameter(e.MAX_VERTEX_ATTRIBS),r={},i=f(null),a=i,o=!1;function s(n,r,i,s,c){let u=!1,f=d(n,s,i,r);a!==f&&(a=f,l(a.object)),u=p(n,s,i,c),u&&m(n,s,i,c),c!==null&&t.update(c,e.ELEMENT_ARRAY_BUFFER),(u||o)&&(o=!1,b(n,r,i,s),c!==null&&e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,t.get(c).buffer))}function c(){return e.createVertexArray()}function l(t){return e.bindVertexArray(t)}function u(t){return e.deleteVertexArray(t)}function d(e,t,n,i){let a=i.wireframe===!0,o=r[t.id];o===void 0&&(o={},r[t.id]=o);let s=e.isInstancedMesh===!0?e.id:0,l=o[s];l===void 0&&(l={},o[s]=l);let u=l[n.id];u===void 0&&(u={},l[n.id]=u);let d=u[a];return d===void 0&&(d=f(c()),u[a]=d),d}function f(e){let t=[],r=[],i=[];for(let e=0;e<n;e++)t[e]=0,r[e]=0,i[e]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:t,enabledAttributes:r,attributeDivisors:i,object:e,attributes:{},index:null}}function p(e,t,n,r){let i=a.attributes,o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=i[t],r=o[t];if(r===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(r=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(r=e.instanceColor)),n===void 0||n.attribute!==r||r&&n.data!==r.data)return!0;s++}return a.attributesNum!==s||a.index!==r}function m(e,t,n,r){let i={},o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=o[t];n===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(n=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(n=e.instanceColor));let r={};r.attribute=n,n&&n.data&&(r.data=n.data),i[t]=r,s++}a.attributes=i,a.attributesNum=s,a.index=r}function h(){let e=a.newAttributes;for(let t=0,n=e.length;t<n;t++)e[t]=0}function g(e){_(e,0)}function _(t,n){let r=a.newAttributes,i=a.enabledAttributes,o=a.attributeDivisors;r[t]=1,i[t]===0&&(e.enableVertexAttribArray(t),i[t]=1),o[t]!==n&&(e.vertexAttribDivisor(t,n),o[t]=n)}function v(){let t=a.newAttributes,n=a.enabledAttributes;for(let r=0,i=n.length;r<i;r++)n[r]!==t[r]&&(e.disableVertexAttribArray(r),n[r]=0)}function y(t,n,r,i,a,o,s){s===!0?e.vertexAttribIPointer(t,n,r,a,o):e.vertexAttribPointer(t,n,r,i,a,o)}function b(n,r,i,a){h();let o=a.attributes,s=i.getAttributes(),c=r.defaultAttributeValues;for(let r in s){let i=s[r];if(i.location>=0){let s=o[r];if(s===void 0&&(r===`instanceMatrix`&&n.instanceMatrix&&(s=n.instanceMatrix),r===`instanceColor`&&n.instanceColor&&(s=n.instanceColor)),s!==void 0){let r=s.normalized,o=s.itemSize,c=t.get(s);if(c===void 0)continue;let l=c.buffer,u=c.type,d=c.bytesPerElement,f=u===e.INT||u===e.UNSIGNED_INT||s.gpuType===1013;if(s.isInterleavedBufferAttribute){let t=s.data,c=t.stride,p=s.offset;if(t.isInstancedInterleavedBuffer){for(let e=0;e<i.locationSize;e++)_(i.location+e,t.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=t.meshPerAttribute*t.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,c*d,(p+o/i.locationSize*e)*d,f)}else{if(s.isInstancedBufferAttribute){for(let e=0;e<i.locationSize;e++)_(i.location+e,s.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=s.meshPerAttribute*s.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,o*d,o/i.locationSize*e*d,f)}}else if(c!==void 0){let t=c[r];if(t!==void 0)switch(t.length){case 2:e.vertexAttrib2fv(i.location,t);break;case 3:e.vertexAttrib3fv(i.location,t);break;case 4:e.vertexAttrib4fv(i.location,t);break;default:e.vertexAttrib1fv(i.location,t)}}}}v()}function x(){T();for(let e in r){let t=r[e];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e]}}function S(e){if(r[e.id]===void 0)return;let t=r[e.id];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e.id]}function C(e){for(let t in r){let n=r[t];for(let t in n){let r=n[t];if(r[e.id]===void 0)continue;let i=r[e.id];for(let e in i)u(i[e].object),delete i[e];delete r[e.id]}}}function w(e){for(let t in r){let n=r[t],i=e.isInstancedMesh===!0?e.id:0,a=n[i];if(a!==void 0){for(let e in a){let t=a[e];for(let e in t)u(t[e].object),delete t[e];delete a[e]}delete n[i],Object.keys(n).length===0&&delete r[t]}}}function T(){E(),o=!0,a!==i&&(a=i,l(a.object))}function E(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:s,reset:T,resetDefaultState:E,dispose:x,releaseStatesOfGeometry:S,releaseStatesOfObject:w,releaseStatesOfProgram:C,initAttributes:h,enableAttribute:g,disableUnusedAttributes:v}}function $m(e,t,n){let r;function i(e){r=e}function a(t,i){e.drawArrays(r,t,i),n.update(i,r,1)}function o(t,i,a){a!==0&&(e.drawArraysInstanced(r,t,i,a),n.update(i,r,a))}function s(e,i,a){if(a===0)return;t.get(`WEBGL_multi_draw`).multiDrawArraysWEBGL(r,e,0,i,0,a);let o=0;for(let e=0;e<a;e++)o+=i[e];n.update(o,r,1)}this.setMode=i,this.render=a,this.renderInstances=o,this.renderMultiDraw=s}function eh(e,t,n,r){let i;function a(){if(i!==void 0)return i;if(t.has(`EXT_texture_filter_anisotropic`)===!0){let n=t.get(`EXT_texture_filter_anisotropic`);i=e.getParameter(n.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function o(t){return!(t!==1023&&r.convert(t)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_FORMAT))}function s(n){let i=n===1016&&(t.has(`EXT_color_buffer_half_float`)||t.has(`EXT_color_buffer_float`));return!(n!==1009&&r.convert(n)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_TYPE)&&n!==1015&&!i)}function c(t){if(t===`highp`){if(e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.HIGH_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.HIGH_FLOAT).precision>0)return`highp`;t=`mediump`}return t===`mediump`&&e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.MEDIUM_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.MEDIUM_FLOAT).precision>0?`mediump`:`lowp`}let l=n.precision===void 0?`highp`:n.precision,u=c(l);u!==l&&(X(`WebGLRenderer:`,l,`not supported, using`,u,`instead.`),l=u);let d=n.logarithmicDepthBuffer===!0,f=n.reversedDepthBuffer===!0&&t.has(`EXT_clip_control`);n.reversedDepthBuffer===!0&&f===!1&&X(`WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.`);let p=e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS),m=e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS),h=e.getParameter(e.MAX_TEXTURE_SIZE),g=e.getParameter(e.MAX_CUBE_MAP_TEXTURE_SIZE),_=e.getParameter(e.MAX_VERTEX_ATTRIBS),v=e.getParameter(e.MAX_VERTEX_UNIFORM_VECTORS),y=e.getParameter(e.MAX_VARYING_VECTORS),b=e.getParameter(e.MAX_FRAGMENT_UNIFORM_VECTORS),x=e.getParameter(e.MAX_SAMPLES),S=e.getParameter(e.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:a,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:s,precision:l,logarithmicDepthBuffer:d,reversedDepthBuffer:f,maxTextures:p,maxVertexTextures:m,maxTextureSize:h,maxCubemapSize:g,maxAttributes:_,maxVertexUniforms:v,maxVaryings:y,maxFragmentUniforms:b,maxSamples:x,samples:S}}function th(e){let t=this,n=null,r=0,i=!1,a=!1,o=new kf,s=new Wl,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(e,t){let n=e.length!==0||t||r!==0||i;return i=t,r=e.length,n},this.beginShadows=function(){a=!0,u(null)},this.endShadows=function(){a=!1},this.setGlobalState=function(e,t){n=u(e,t,0)},this.setState=function(t,o,s){let d=t.clippingPlanes,f=t.clipIntersection,p=t.clipShadows,m=e.get(t);if(!i||d===null||d.length===0||a&&!p)a?u(null):l();else{let e=a?0:r,t=e*4,i=m.clippingState||null;c.value=i,i=u(d,o,t,s);for(let e=0;e!==t;++e)i[e]=n[e];m.clippingState=i,this.numIntersection=f?this.numPlanes:0,this.numPlanes+=e}};function l(){c.value!==n&&(c.value=n,c.needsUpdate=r>0),t.numPlanes=r,t.numIntersection=0}function u(e,n,r,i){let a=e===null?0:e.length,l=null;if(a!==0){if(l=c.value,i!==!0||l===null){let t=r+a*4,i=n.matrixWorldInverse;s.getNormalMatrix(i),(l===null||l.length<t)&&(l=new Float32Array(t));for(let t=0,n=r;t!==a;++t,n+=4)o.copy(e[t]).applyMatrix4(i,s),o.normal.toArray(l,n),l[n+3]=o.constant}c.value=l,c.needsUpdate=!0}return t.numPlanes=a,t.numIntersection=0,l}}var nh=4,rh=[.125,.215,.35,.446,.526,.582],ih=20,ah=256,oh=new bm,sh=new Ku,ch=null,lh=0,uh=0,dh=!1,fh=new Q,ph=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,n=.1,r=100,i={}){let{size:a=256,position:o=fh}=i;ch=this._renderer.getRenderTarget(),lh=this._renderer.getActiveCubeFace(),uh=this._renderer.getActiveMipmapLevel(),dh=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let s=this._allocateTargets();return s.depthBuffer=!0,this._sceneToCubeUV(e,n,r,s,o),t>0&&this._blur(s,0,0,t),this._applyPMREM(s),this._cleanup(s),s}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=bh(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=yh(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=2**this._lodMax}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(ch,lh,uh),this._renderer.xr.enabled=dh,e.scissorTest=!1,gh(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===301||e.mapping===302?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),ch=this._renderer.getRenderTarget(),lh=this._renderer.getActiveCubeFace(),uh=this._renderer.getActiveMipmapLevel(),dh=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Ms,minFilter:Ms,generateMipmaps:!1,type:Hs,format:Xs,colorSpace:Yc,depthBuffer:!1},r=hh(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=hh(e,t,n);let{_lodMax:r}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=mh(r)),this._blurMaterial=vh(r,e,t),this._ggxMaterial=_h(r,e,t)}return r}_compileMaterial(e){let t=new pf(new Ud,e);this._renderer.compile(t,oh)}_sceneToCubeUV(e,t,n,r,i){let a=new _m(90,1,t,n),o=[1,-1,1,1,1,1],s=[1,1,1,-1,-1,-1],c=this._renderer,l=c.autoClear,u=c.toneMapping;c.getClearColor(sh),c.toneMapping=0,c.autoClear=!1,c.state.buffers.depth.getReversed()&&(c.setRenderTarget(r),c.clearDepth(),c.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new pf(new Kf,new ef({name:`PMREM.Background`,side:1,depthWrite:!1,depthTest:!1})));let d=this._backgroundBox,f=d.material,p=!1,m=e.background;m?m.isColor&&(f.color.copy(m),e.background=null,p=!0):(f.color.copy(sh),p=!0);for(let t=0;t<6;t++){let n=t%3;n===0?(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x+s[t],i.y,i.z)):n===1?(a.up.set(0,0,o[t]),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y+s[t],i.z)):(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y,i.z+s[t]));let l=this._cubeSize;gh(r,n*l,t>2?l:0,l,l),c.setRenderTarget(r),p&&c.render(d,a),c.render(e,a)}c.toneMapping=u,c.autoClear=l,e.background=m}_textureToCubeUV(e,t){let n=this._renderer,r=e.mapping===301||e.mapping===302;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=bh()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=yh());let i=r?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=i;let o=i.uniforms;o.envMap.value=e;let s=this._cubeSize;gh(t,0,0,3*s,2*s),n.setRenderTarget(t),n.render(a,oh)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let r=this._lodMeshes.length;for(let t=1;t<r;t++)this._applyGGXFilter(e,t-1,t);t.autoClear=n}_applyGGXFilter(e,t,n){let r=this._renderer,i=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[n];o.material=a;let s=a.uniforms,c=n/(this._lodMeshes.length-1),l=t/(this._lodMeshes.length-1),u=Math.sqrt(c*c-l*l)*(0+c*1.25),{_lodMax:d}=this,f=this._sizeLods[n],p=3*f*(n>d-nh?n-d+nh:0),m=4*(this._cubeSize-f);s.envMap.value=e.texture,s.roughness.value=u,s.mipInt.value=d-t,gh(i,p,m,3*f,2*f),r.setRenderTarget(i),r.render(o,oh),s.envMap.value=i.texture,s.roughness.value=0,s.mipInt.value=d-n,gh(e,p,m,3*f,2*f),r.setRenderTarget(e),r.render(o,oh)}_blur(e,t,n,r,i){let a=this._pingPongRenderTarget;this._halfBlur(e,a,t,n,r,`latitudinal`,i),this._halfBlur(a,e,n,n,r,`longitudinal`,i)}_halfBlur(e,t,n,r,i,a,o){let s=this._renderer,c=this._blurMaterial;a!==`latitudinal`&&a!==`longitudinal`&&ll(`blur direction must be either latitudinal or longitudinal!`);let l=this._lodMeshes[r];l.material=c;let u=c.uniforms,d=this._sizeLods[n]-1,f=isFinite(i)?Math.PI/(2*d):2*Math.PI/(2*ih-1),p=i/f,m=isFinite(i)?1+Math.floor(3*p):ih;m>ih&&X(`sigmaRadians, ${i}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${ih}`);let h=[],g=0;for(let e=0;e<ih;++e){let t=e/p,n=Math.exp(-t*t/2);h.push(n),e===0?g+=n:e<m&&(g+=2*n)}for(let e=0;e<h.length;e++)h[e]=h[e]/g;u.envMap.value=e.texture,u.samples.value=m,u.weights.value=h,u.latitudinal.value=a===`latitudinal`,o&&(u.poleAxis.value=o);let{_lodMax:_}=this;u.dTheta.value=f,u.mipInt.value=_-n;let v=this._sizeLods[r];gh(t,3*v*(r>_-nh?r-_+nh:0),4*(this._cubeSize-v),3*v,2*v),s.setRenderTarget(t),s.render(l,oh)}};function mh(e){let t=[],n=[],r=[],i=e,a=e-nh+1+rh.length;for(let o=0;o<a;o++){let a=2**i;t.push(a);let s=1/a;o>e-nh?s=rh[o-e+nh-1]:o===0&&(s=0),n.push(s);let c=1/(a-2),l=-c,u=1+c,d=[l,l,u,l,u,u,l,l,u,u,l,u],f=new Float32Array(108),p=new Float32Array(72),m=new Float32Array(36);for(let e=0;e<6;e++){let t=e%3*2/3-1,n=e>2?0:-1,r=[t,n,0,t+2/3,n,0,t+2/3,n+1,0,t,n,0,t+2/3,n+1,0,t,n+1,0];f.set(r,18*e),p.set(d,12*e);let i=[e,e,e,e,e,e];m.set(i,6*e)}let h=new Ud;h.setAttribute(`position`,new Od(f,3)),h.setAttribute(`uv`,new Od(p,2)),h.setAttribute(`faceIndex`,new Od(m,1)),r.push(new pf(h,null)),i>nh&&i--}return{lodMeshes:r,sizeLods:t,sigmas:n}}function hh(e,t,n){let r=new cu(e,t,n);return r.texture.mapping=306,r.texture.name=`PMREM.cubeUv`,r.scissorTest=!0,r}function gh(e,t,n,r,i){e.viewport.set(t,n,r,i),e.scissor.set(t,n,r,i)}function _h(e,t,n){return new Ip({name:`PMREMGGXConvolution`,defines:{GGX_SAMPLES:ah,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:xh(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function vh(e,t,n){let r=new Float32Array(ih),i=new Q(0,1,0);return new Ip({name:`SphericalGaussianBlur`,defines:{n:ih,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:r},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:xh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function yh(){return new Ip({name:`EquirectangularToCubeUV`,uniforms:{envMap:{value:null}},vertexShader:xh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function bh(){return new Ip({name:`CubemapToCubeUV`,uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:xh(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function xh(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}var Sh=class extends cu{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},r=[n,n,n,n,n,n];this.texture=new Vf(r),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},r=new Kf(5,5,5),i=new Ip({name:`CubemapFromEquirect`,uniforms:Op(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:1,blending:0});i.uniforms.tEquirect.value=t;let a=new pf(r,i),o=t.minFilter;return t.minFilter===1008&&(t.minFilter=Ms),new Em(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,r=!0){let i=e.getRenderTarget();for(let i=0;i<6;i++)e.setRenderTarget(this,i),e.clear(t,n,r);e.setRenderTarget(i)}};function Ch(e){let t=new WeakMap,n=new WeakMap,r=null;function i(e,t=!1){return e==null?null:t?o(e):a(e)}function a(n){if(n&&n.isTexture){let r=n.mapping;if(r===303||r===304)if(t.has(n)){let e=t.get(n).texture;return s(e,n.mapping)}else{let r=n.image;if(r&&r.height>0){let i=new Sh(r.height);return i.fromEquirectangularTexture(e,n),t.set(n,i),n.addEventListener(`dispose`,l),s(i.texture,n.mapping)}else return null}}return n}function o(t){if(t&&t.isTexture){let i=t.mapping,a=i===303||i===304,o=i===301||i===302;if(a||o){let i=n.get(t),s=i===void 0?0:i.texture.pmremVersion;if(t.isRenderTargetTexture&&t.pmremVersion!==s)return r===null&&(r=new ph(e)),i=a?r.fromEquirectangular(t,i):r.fromCubemap(t,i),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),i.texture;if(i!==void 0)return i.texture;{let s=t.image;return a&&s&&s.height>0||o&&s&&c(s)?(r===null&&(r=new ph(e)),i=a?r.fromEquirectangular(t):r.fromCubemap(t),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),t.addEventListener(`dispose`,u),i.texture):null}}}return t}function s(e,t){return t===303?e.mapping=301:t===304&&(e.mapping=302),e}function c(e){let t=0;for(let n=0;n<6;n++)e[n]!==void 0&&t++;return t===6}function l(e){let n=e.target;n.removeEventListener(`dispose`,l);let r=t.get(n);r!==void 0&&(t.delete(n),r.dispose())}function u(e){let t=e.target;t.removeEventListener(`dispose`,u);let r=n.get(t);r!==void 0&&(n.delete(t),r.dispose())}function d(){t=new WeakMap,n=new WeakMap,r!==null&&(r.dispose(),r=null)}return{get:i,dispose:d}}function wh(e){let t={};function n(n){if(t[n]!==void 0)return t[n];let r=e.getExtension(n);return t[n]=r,r}return{has:function(e){return n(e)!==null},init:function(){n(`EXT_color_buffer_float`),n(`WEBGL_clip_cull_distance`),n(`OES_texture_float_linear`),n(`EXT_color_buffer_half_float`),n(`WEBGL_multisampled_render_to_texture`),n(`WEBGL_render_shared_exponent`)},get:function(e){let t=n(e);return t===null&&ul(`WebGLRenderer: `+e+` extension not supported.`),t}}}function Th(e,t,n,r){let i={},a=new WeakMap;function o(e){let s=e.target;s.index!==null&&t.remove(s.index);for(let e in s.attributes)t.remove(s.attributes[e]);s.removeEventListener(`dispose`,o),delete i[s.id];let c=a.get(s);c&&(t.remove(c),a.delete(s)),r.releaseStatesOfGeometry(s),s.isInstancedBufferGeometry===!0&&delete s._maxInstanceCount,n.memory.geometries--}function s(e,t){return i[t.id]===!0?t:(t.addEventListener(`dispose`,o),i[t.id]=!0,n.memory.geometries++,t)}function c(n){let r=n.attributes;for(let n in r)t.update(r[n],e.ARRAY_BUFFER)}function l(e){let n=[],r=e.index,i=e.attributes.position,o=0;if(i===void 0)return;if(r!==null){let e=r.array;o=r.version;for(let t=0,r=e.length;t<r;t+=3){let r=e[t+0],i=e[t+1],a=e[t+2];n.push(r,i,i,a,a,r)}}else{let e=i.array;o=i.version;for(let t=0,r=e.length/3-1;t<r;t+=3){let e=t+0,r=t+1,i=t+2;n.push(e,r,r,i,i,e)}}let s=new(i.count>=65535?Ad:kd)(n,1);s.version=o;let c=a.get(e);c&&t.remove(c),a.set(e,s)}function u(e){let t=a.get(e);if(t){let n=e.index;n!==null&&t.version<n.version&&l(e)}else l(e);return a.get(e)}return{get:s,update:c,getWireframeAttribute:u}}function Eh(e,t,n){let r;function i(e){r=e}let a,o;function s(e){a=e.type,o=e.bytesPerElement}function c(t,i){e.drawElements(r,i,a,t*o),n.update(i,r,1)}function l(t,i,s){s!==0&&(e.drawElementsInstanced(r,i,a,t*o,s),n.update(i,r,s))}function u(e,i,o){if(o===0)return;t.get(`WEBGL_multi_draw`).multiDrawElementsWEBGL(r,i,0,a,e,0,o);let s=0;for(let e=0;e<o;e++)s+=i[e];n.update(s,r,1)}this.setMode=i,this.setIndex=s,this.render=c,this.renderInstances=l,this.renderMultiDraw=u}function Dh(e){let t={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function r(t,r,i){switch(n.calls++,r){case e.TRIANGLES:n.triangles+=t/3*i;break;case e.LINES:n.lines+=t/2*i;break;case e.LINE_STRIP:n.lines+=i*(t-1);break;case e.LINE_LOOP:n.lines+=i*t;break;case e.POINTS:n.points+=i*t;break;default:ll(`WebGLInfo: Unknown draw mode:`,r);break}}function i(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:t,render:n,programs:null,autoReset:!0,reset:i,update:r}}function Oh(e,t,n){let r=new WeakMap,i=new ou;function a(a,o,s){let c=a.morphTargetInfluences,l=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=l===void 0?0:l.length,d=r.get(o);if(d===void 0||d.count!==u){d!==void 0&&d.texture.dispose();let e=o.morphAttributes.position!==void 0,n=o.morphAttributes.normal!==void 0,a=o.morphAttributes.color!==void 0,s=o.morphAttributes.position||[],c=o.morphAttributes.normal||[],l=o.morphAttributes.color||[],f=0;e===!0&&(f=1),n===!0&&(f=2),a===!0&&(f=3);let p=o.attributes.position.count*f,m=1;p>t.maxTextureSize&&(m=Math.ceil(p/t.maxTextureSize),p=t.maxTextureSize);let h=new Float32Array(p*m*4*u),g=new lu(h,p,m,u);g.type=Vs,g.needsUpdate=!0;let _=f*4;for(let t=0;t<u;t++){let r=s[t],o=c[t],u=l[t],d=p*m*4*t;for(let t=0;t<r.count;t++){let s=t*_;e===!0&&(i.fromBufferAttribute(r,t),h[d+s+0]=i.x,h[d+s+1]=i.y,h[d+s+2]=i.z,h[d+s+3]=0),n===!0&&(i.fromBufferAttribute(o,t),h[d+s+4]=i.x,h[d+s+5]=i.y,h[d+s+6]=i.z,h[d+s+7]=0),a===!0&&(i.fromBufferAttribute(u,t),h[d+s+8]=i.x,h[d+s+9]=i.y,h[d+s+10]=i.z,h[d+s+11]=u.itemSize===4?i.w:1)}}d={count:u,texture:g,size:new Z(p,m)},r.set(o,d);function v(){g.dispose(),r.delete(o),o.removeEventListener(`dispose`,v)}o.addEventListener(`dispose`,v)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)s.getUniforms().setValue(e,`morphTexture`,a.morphTexture,n);else{let t=0;for(let e=0;e<c.length;e++)t+=c[e];let n=o.morphTargetsRelative?1:1-t;s.getUniforms().setValue(e,`morphTargetBaseInfluence`,n),s.getUniforms().setValue(e,`morphTargetInfluences`,c)}s.getUniforms().setValue(e,`morphTargetsTexture`,d.texture,n),s.getUniforms().setValue(e,`morphTargetsTextureSize`,d.size)}return{update:a}}function kh(e,t,n,r,i){let a=new WeakMap;function o(r){let o=i.render.frame,s=r.geometry,l=t.get(r,s);if(a.get(l)!==o&&(t.update(l),a.set(l,o)),r.isInstancedMesh&&(r.hasEventListener(`dispose`,c)===!1&&r.addEventListener(`dispose`,c),a.get(r)!==o&&(n.update(r.instanceMatrix,e.ARRAY_BUFFER),r.instanceColor!==null&&n.update(r.instanceColor,e.ARRAY_BUFFER),a.set(r,o))),r.isSkinnedMesh){let e=r.skeleton;a.get(e)!==o&&(e.update(),a.set(e,o))}return l}function s(){a=new WeakMap}function c(e){let t=e.target;t.removeEventListener(`dispose`,c),r.releaseStatesOfObject(t),n.remove(t.instanceMatrix),t.instanceColor!==null&&n.remove(t.instanceColor)}return{update:o,dispose:s}}var Ah={1:`LINEAR_TONE_MAPPING`,2:`REINHARD_TONE_MAPPING`,3:`CINEON_TONE_MAPPING`,4:`ACES_FILMIC_TONE_MAPPING`,6:`AGX_TONE_MAPPING`,7:`NEUTRAL_TONE_MAPPING`,5:`CUSTOM_TONE_MAPPING`};function jh(e,t,n,r,i,a){let o=new cu(t,n,{type:e,depthBuffer:i,stencilBuffer:a,samples:r?4:0,depthTexture:i?new Uf(t,n):void 0}),s=new cu(t,n,{type:Hs,depthBuffer:!1,stencilBuffer:!1}),c=new Ud;c.setAttribute(`position`,new jd([-1,3,0,-1,-1,0,3,-1,0],3)),c.setAttribute(`uv`,new jd([0,2,0,0,2,0],2));let l=new Lp({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),u=new pf(c,l),d=new bm(-1,1,1,-1,0,1),f=null,p=null,m=!1,h,g=null,_=[],v=!1;this.setSize=function(e,t){o.setSize(e,t),s.setSize(e,t);for(let n=0;n<_.length;n++){let r=_[n];r.setSize&&r.setSize(e,t)}},this.setEffects=function(e){_=e,v=_.length>0&&_[0].isRenderPass===!0;let t=o.width,n=o.height;for(let e=0;e<_.length;e++){let r=_[e];r.setSize&&r.setSize(t,n)}},this.begin=function(e,t){if(m||e.toneMapping===0&&_.length===0)return!1;if(g=t,t!==null){let e=t.width,n=t.height;(o.width!==e||o.height!==n)&&this.setSize(e,n)}return v===!1&&e.setRenderTarget(o),h=e.toneMapping,e.toneMapping=0,!0},this.hasRenderPass=function(){return v},this.end=function(e,t){e.toneMapping=h,m=!0;let n=o,r=s;for(let i=0;i<_.length;i++){let a=_[i];if(a.enabled!==!1&&(a.render(e,r,n,t),a.needsSwap!==!1)){let e=n;n=r,r=e}}if(f!==e.outputColorSpace||p!==e.toneMapping){f=e.outputColorSpace,p=e.toneMapping,l.defines={},Yl.getTransfer(f)===`srgb`&&(l.defines.SRGB_TRANSFER=``);let t=Ah[p];t&&(l.defines[t]=``),l.needsUpdate=!0}l.uniforms.tDiffuse.value=n.texture,e.setRenderTarget(g),e.render(u,d),g=null,m=!1},this.isCompositing=function(){return m},this.dispose=function(){o.depthTexture&&o.depthTexture.dispose(),o.dispose(),s.dispose(),c.dispose(),l.dispose()}}var Mh=new au,Nh=new Uf(1,1),Ph=new lu,Fh=new uu,Ih=new Vf,Lh=[],Rh=[],zh=new Float32Array(16),Bh=new Float32Array(9),Vh=new Float32Array(4);function Hh(e,t,n){let r=e[0];if(r<=0||r>0)return e;let i=t*n,a=Lh[i];if(a===void 0&&(a=new Float32Array(i),Lh[i]=a),t!==0){r.toArray(a,0);for(let r=1,i=0;r!==t;++r)i+=n,e[r].toArray(a,i)}return a}function Uh(e,t){if(e.length!==t.length)return!1;for(let n=0,r=e.length;n<r;n++)if(e[n]!==t[n])return!1;return!0}function Wh(e,t){for(let n=0,r=t.length;n<r;n++)e[n]=t[n]}function Gh(e,t){let n=Rh[t];n===void 0&&(n=new Int32Array(t),Rh[t]=n);for(let r=0;r!==t;++r)n[r]=e.allocateTextureUnit();return n}function Kh(e,t){let n=this.cache;n[0]!==t&&(e.uniform1f(this.addr,t),n[0]=t)}function qh(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2f(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(Uh(n,t))return;e.uniform2fv(this.addr,t),Wh(n,t)}}function Jh(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3f(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else if(t.r!==void 0)(n[0]!==t.r||n[1]!==t.g||n[2]!==t.b)&&(e.uniform3f(this.addr,t.r,t.g,t.b),n[0]=t.r,n[1]=t.g,n[2]=t.b);else{if(Uh(n,t))return;e.uniform3fv(this.addr,t),Wh(n,t)}}function Yh(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4f(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(Uh(n,t))return;e.uniform4fv(this.addr,t),Wh(n,t)}}function Xh(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(Uh(n,t))return;e.uniformMatrix2fv(this.addr,!1,t),Wh(n,t)}else{if(Uh(n,r))return;Vh.set(r),e.uniformMatrix2fv(this.addr,!1,Vh),Wh(n,r)}}function Zh(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(Uh(n,t))return;e.uniformMatrix3fv(this.addr,!1,t),Wh(n,t)}else{if(Uh(n,r))return;Bh.set(r),e.uniformMatrix3fv(this.addr,!1,Bh),Wh(n,r)}}function Qh(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(Uh(n,t))return;e.uniformMatrix4fv(this.addr,!1,t),Wh(n,t)}else{if(Uh(n,r))return;zh.set(r),e.uniformMatrix4fv(this.addr,!1,zh),Wh(n,r)}}function $h(e,t){let n=this.cache;n[0]!==t&&(e.uniform1i(this.addr,t),n[0]=t)}function eg(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2i(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(Uh(n,t))return;e.uniform2iv(this.addr,t),Wh(n,t)}}function tg(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3i(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(Uh(n,t))return;e.uniform3iv(this.addr,t),Wh(n,t)}}function ng(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4i(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(Uh(n,t))return;e.uniform4iv(this.addr,t),Wh(n,t)}}function rg(e,t){let n=this.cache;n[0]!==t&&(e.uniform1ui(this.addr,t),n[0]=t)}function ig(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2ui(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(Uh(n,t))return;e.uniform2uiv(this.addr,t),Wh(n,t)}}function ag(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3ui(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(Uh(n,t))return;e.uniform3uiv(this.addr,t),Wh(n,t)}}function og(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4ui(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(Uh(n,t))return;e.uniform4uiv(this.addr,t),Wh(n,t)}}function sg(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i);let a;this.type===e.SAMPLER_2D_SHADOW?(Nh.compareFunction=n.isReversedDepthBuffer()?518:515,a=Nh):a=Mh,n.setTexture2D(t||a,i)}function cg(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture3D(t||Fh,i)}function lg(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTextureCube(t||Ih,i)}function ug(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture2DArray(t||Ph,i)}function dg(e){switch(e){case 5126:return Kh;case 35664:return qh;case 35665:return Jh;case 35666:return Yh;case 35674:return Xh;case 35675:return Zh;case 35676:return Qh;case 5124:case 35670:return $h;case 35667:case 35671:return eg;case 35668:case 35672:return tg;case 35669:case 35673:return ng;case 5125:return rg;case 36294:return ig;case 36295:return ag;case 36296:return og;case 35678:case 36198:case 36298:case 36306:case 35682:return sg;case 35679:case 36299:case 36307:return cg;case 35680:case 36300:case 36308:case 36293:return lg;case 36289:case 36303:case 36311:case 36292:return ug}}function fg(e,t){e.uniform1fv(this.addr,t)}function pg(e,t){let n=Hh(t,this.size,2);e.uniform2fv(this.addr,n)}function mg(e,t){let n=Hh(t,this.size,3);e.uniform3fv(this.addr,n)}function hg(e,t){let n=Hh(t,this.size,4);e.uniform4fv(this.addr,n)}function gg(e,t){let n=Hh(t,this.size,4);e.uniformMatrix2fv(this.addr,!1,n)}function _g(e,t){let n=Hh(t,this.size,9);e.uniformMatrix3fv(this.addr,!1,n)}function vg(e,t){let n=Hh(t,this.size,16);e.uniformMatrix4fv(this.addr,!1,n)}function yg(e,t){e.uniform1iv(this.addr,t)}function bg(e,t){e.uniform2iv(this.addr,t)}function xg(e,t){e.uniform3iv(this.addr,t)}function Sg(e,t){e.uniform4iv(this.addr,t)}function Cg(e,t){e.uniform1uiv(this.addr,t)}function wg(e,t){e.uniform2uiv(this.addr,t)}function Tg(e,t){e.uniform3uiv(this.addr,t)}function Eg(e,t){e.uniform4uiv(this.addr,t)}function Dg(e,t,n){let r=this.cache,i=t.length,a=Gh(n,i);Uh(r,a)||(e.uniform1iv(this.addr,a),Wh(r,a));let o;o=this.type===e.SAMPLER_2D_SHADOW?Nh:Mh;for(let e=0;e!==i;++e)n.setTexture2D(t[e]||o,a[e])}function Og(e,t,n){let r=this.cache,i=t.length,a=Gh(n,i);Uh(r,a)||(e.uniform1iv(this.addr,a),Wh(r,a));for(let e=0;e!==i;++e)n.setTexture3D(t[e]||Fh,a[e])}function kg(e,t,n){let r=this.cache,i=t.length,a=Gh(n,i);Uh(r,a)||(e.uniform1iv(this.addr,a),Wh(r,a));for(let e=0;e!==i;++e)n.setTextureCube(t[e]||Ih,a[e])}function Ag(e,t,n){let r=this.cache,i=t.length,a=Gh(n,i);Uh(r,a)||(e.uniform1iv(this.addr,a),Wh(r,a));for(let e=0;e!==i;++e)n.setTexture2DArray(t[e]||Ph,a[e])}function jg(e){switch(e){case 5126:return fg;case 35664:return pg;case 35665:return mg;case 35666:return hg;case 35674:return gg;case 35675:return _g;case 35676:return vg;case 5124:case 35670:return yg;case 35667:case 35671:return bg;case 35668:case 35672:return xg;case 35669:case 35673:return Sg;case 5125:return Cg;case 36294:return wg;case 36295:return Tg;case 36296:return Eg;case 35678:case 36198:case 36298:case 36306:case 35682:return Dg;case 35679:case 36299:case 36307:return Og;case 35680:case 36300:case 36308:case 36293:return kg;case 36289:case 36303:case 36311:case 36292:return Ag}}var Mg=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=dg(t.type)}},Ng=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=jg(t.type)}},Pg=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let r=this.seq;for(let i=0,a=r.length;i!==a;++i){let a=r[i];a.setValue(e,t[a.id],n)}}},Fg=/(\w+)(\])?(\[|\.)?/g;function Ig(e,t){e.seq.push(t),e.map[t.id]=t}function Lg(e,t,n){let r=e.name,i=r.length;for(Fg.lastIndex=0;;){let a=Fg.exec(r),o=Fg.lastIndex,s=a[1],c=a[2]===`]`,l=a[3];if(c&&(s|=0),l===void 0||l===`[`&&o+2===i){Ig(n,l===void 0?new Mg(s,e,t):new Ng(s,e,t));break}else{let e=n.map[s];e===void 0&&(e=new Pg(s),Ig(n,e)),n=e}}}var Rg=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let r=0;r<n;++r){let n=e.getActiveUniform(t,r);Lg(n,e.getUniformLocation(t,n.name),this)}let r=[],i=[];for(let t of this.seq)t.type===e.SAMPLER_2D_SHADOW||t.type===e.SAMPLER_CUBE_SHADOW||t.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(t):i.push(t);r.length>0&&(this.seq=r.concat(i))}setValue(e,t,n,r){let i=this.map[t];i!==void 0&&i.setValue(e,n,r)}setOptional(e,t,n){let r=t[n];r!==void 0&&this.setValue(e,n,r)}static upload(e,t,n,r){for(let i=0,a=t.length;i!==a;++i){let a=t[i],o=n[a.id];o.needsUpdate!==!1&&a.setValue(e,o.value,r)}}static seqWithValue(e,t){let n=[];for(let r=0,i=e.length;r!==i;++r){let i=e[r];i.id in t&&n.push(i)}return n}};function zg(e,t,n){let r=e.createShader(t);return e.shaderSource(r,n),e.compileShader(r),r}var Bg=37297,Vg=0;function Hg(e,t){let n=e.split(`
`),r=[],i=Math.max(t-6,0),a=Math.min(t+6,n.length);for(let e=i;e<a;e++){let i=e+1;r.push(`${i===t?`>`:` `} ${i}: ${n[e]}`)}return r.join(`
`)}var Ug=new Wl;function Wg(e){Yl._getMatrix(Ug,Yl.workingColorSpace,e);let t=`mat3( ${Ug.elements.map(e=>e.toFixed(4))} )`;switch(Yl.getTransfer(e)){case Xc:return[t,`LinearTransferOETF`];case Zc:return[t,`sRGBTransferOETF`];default:return X(`WebGLProgram: Unsupported color space: `,e),[t,`LinearTransferOETF`]}}function Gg(e,t,n){let r=e.getShaderParameter(t,e.COMPILE_STATUS),i=(e.getShaderInfoLog(t)||``).trim();if(r&&i===``)return``;let a=/ERROR: 0:(\d+)/.exec(i);if(a){let r=parseInt(a[1]);return n.toUpperCase()+`

`+i+`

`+Hg(e.getShaderSource(t),r)}else return i}function Kg(e,t){let n=Wg(t);return[`vec4 ${e}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,`}`].join(`
`)}var qg={1:`Linear`,2:`Reinhard`,3:`Cineon`,4:`ACESFilmic`,6:`AgX`,7:`Neutral`,5:`Custom`};function Jg(e,t){let n=qg[t];return n===void 0?(X(`WebGLProgram: Unsupported toneMapping:`,t),`vec3 `+e+`( vec3 color ) { return LinearToneMapping( color ); }`):`vec3 `+e+`( vec3 color ) { return `+n+`ToneMapping( color ); }`}var Yg=new Q;function Xg(){return Yl.getLuminanceCoefficients(Yg),[`float luminance( const in vec3 rgb ) {`,`	const vec3 weights = vec3( ${Yg.x.toFixed(4)}, ${Yg.y.toFixed(4)}, ${Yg.z.toFixed(4)} );`,`	return dot( weights, rgb );`,`}`].join(`
`)}function Zg(e){return[e.extensionClipCullDistance?`#extension GL_ANGLE_clip_cull_distance : require`:``,e.extensionMultiDraw?`#extension GL_ANGLE_multi_draw : require`:``].filter(e_).join(`
`)}function Qg(e){let t=[];for(let n in e){let r=e[n];r!==!1&&t.push(`#define `+n+` `+r)}return t.join(`
`)}function $g(e,t){let n={},r=e.getProgramParameter(t,e.ACTIVE_ATTRIBUTES);for(let i=0;i<r;i++){let r=e.getActiveAttrib(t,i),a=r.name,o=1;r.type===e.FLOAT_MAT2&&(o=2),r.type===e.FLOAT_MAT3&&(o=3),r.type===e.FLOAT_MAT4&&(o=4),n[a]={type:r.type,location:e.getAttribLocation(t,a),locationSize:o}}return n}function e_(e){return e!==``}function t_(e,t){let n=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return e.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function n_(e,t){return e.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var r_=/^[ \t]*#include +<([\w\d./]+)>/gm;function i_(e){return e.replace(r_,o_)}var a_=new Map;function o_(e,t){let n=Km[t];if(n===void 0){let e=a_.get(t);if(e!==void 0)n=Km[e],X(`WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.`,t,e);else throw Error(`THREE.WebGLProgram: Can not resolve #include <`+t+`>`)}return i_(n)}var s_=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function c_(e){return e.replace(s_,l_)}function l_(e,t,n,r){let i=``;for(let e=parseInt(t);e<parseInt(n);e++)i+=r.replace(/\[\s*i\s*\]/g,`[ `+e+` ]`).replace(/UNROLLED_LOOP_INDEX/g,e);return i}function u_(e){let t=`precision ${e.precision} float;
	precision ${e.precision} int;
	precision ${e.precision} sampler2D;
	precision ${e.precision} samplerCube;
	precision ${e.precision} sampler3D;
	precision ${e.precision} sampler2DArray;
	precision ${e.precision} sampler2DShadow;
	precision ${e.precision} samplerCubeShadow;
	precision ${e.precision} sampler2DArrayShadow;
	precision ${e.precision} isampler2D;
	precision ${e.precision} isampler3D;
	precision ${e.precision} isamplerCube;
	precision ${e.precision} isampler2DArray;
	precision ${e.precision} usampler2D;
	precision ${e.precision} usampler3D;
	precision ${e.precision} usamplerCube;
	precision ${e.precision} usampler2DArray;
	`;return e.precision===`highp`?t+=`
#define HIGH_PRECISION`:e.precision===`mediump`?t+=`
#define MEDIUM_PRECISION`:e.precision===`lowp`&&(t+=`
#define LOW_PRECISION`),t}var d_={1:`SHADOWMAP_TYPE_PCF`,3:`SHADOWMAP_TYPE_VSM`};function f_(e){return d_[e.shadowMapType]||`SHADOWMAP_TYPE_BASIC`}var p_={301:`ENVMAP_TYPE_CUBE`,302:`ENVMAP_TYPE_CUBE`,306:`ENVMAP_TYPE_CUBE_UV`};function m_(e){return e.envMap===!1?`ENVMAP_TYPE_CUBE`:p_[e.envMapMode]||`ENVMAP_TYPE_CUBE`}var h_={302:`ENVMAP_MODE_REFRACTION`};function g_(e){return e.envMap===!1?`ENVMAP_MODE_REFLECTION`:h_[e.envMapMode]||`ENVMAP_MODE_REFLECTION`}var __={0:`ENVMAP_BLENDING_MULTIPLY`,1:`ENVMAP_BLENDING_MIX`,2:`ENVMAP_BLENDING_ADD`};function v_(e){return e.envMap===!1?`ENVMAP_BLENDING_NONE`:__[e.combine]||`ENVMAP_BLENDING_NONE`}function y_(e){let t=e.envMapCubeUVHeight;if(t===null)return null;let n=Math.log2(t)-2,r=1/t;return{texelWidth:1/(3*Math.max(2**n,112)),texelHeight:r,maxMip:n}}function b_(e,t,n,r){let i=e.getContext(),a=n.defines,o=n.vertexShader,s=n.fragmentShader,c=f_(n),l=m_(n),u=g_(n),d=v_(n),f=y_(n),p=Zg(n),m=Qg(a),h=i.createProgram(),g,_,v=n.glslVersion?`#version `+n.glslVersion+`
`:``;n.isRawShaderMaterial?(g=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(e_).join(`
`),g.length>0&&(g+=`
`),_=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(e_).join(`
`),_.length>0&&(_+=`
`)):(g=[u_(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.extensionClipCullDistance?`#define USE_CLIP_DISTANCE`:``,n.batching?`#define USE_BATCHING`:``,n.batchingColor?`#define USE_BATCHING_COLOR`:``,n.instancing?`#define USE_INSTANCING`:``,n.instancingColor?`#define USE_INSTANCING_COLOR`:``,n.instancingMorph?`#define USE_INSTANCING_MORPH`:``,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.map?`#define USE_MAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+u:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.displacementMap?`#define USE_DISPLACEMENTMAP`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.mapUv?`#define MAP_UV `+n.mapUv:``,n.alphaMapUv?`#define ALPHAMAP_UV `+n.alphaMapUv:``,n.lightMapUv?`#define LIGHTMAP_UV `+n.lightMapUv:``,n.aoMapUv?`#define AOMAP_UV `+n.aoMapUv:``,n.emissiveMapUv?`#define EMISSIVEMAP_UV `+n.emissiveMapUv:``,n.bumpMapUv?`#define BUMPMAP_UV `+n.bumpMapUv:``,n.normalMapUv?`#define NORMALMAP_UV `+n.normalMapUv:``,n.displacementMapUv?`#define DISPLACEMENTMAP_UV `+n.displacementMapUv:``,n.metalnessMapUv?`#define METALNESSMAP_UV `+n.metalnessMapUv:``,n.roughnessMapUv?`#define ROUGHNESSMAP_UV `+n.roughnessMapUv:``,n.anisotropyMapUv?`#define ANISOTROPYMAP_UV `+n.anisotropyMapUv:``,n.clearcoatMapUv?`#define CLEARCOATMAP_UV `+n.clearcoatMapUv:``,n.clearcoatNormalMapUv?`#define CLEARCOAT_NORMALMAP_UV `+n.clearcoatNormalMapUv:``,n.clearcoatRoughnessMapUv?`#define CLEARCOAT_ROUGHNESSMAP_UV `+n.clearcoatRoughnessMapUv:``,n.iridescenceMapUv?`#define IRIDESCENCEMAP_UV `+n.iridescenceMapUv:``,n.iridescenceThicknessMapUv?`#define IRIDESCENCE_THICKNESSMAP_UV `+n.iridescenceThicknessMapUv:``,n.sheenColorMapUv?`#define SHEEN_COLORMAP_UV `+n.sheenColorMapUv:``,n.sheenRoughnessMapUv?`#define SHEEN_ROUGHNESSMAP_UV `+n.sheenRoughnessMapUv:``,n.specularMapUv?`#define SPECULARMAP_UV `+n.specularMapUv:``,n.specularColorMapUv?`#define SPECULAR_COLORMAP_UV `+n.specularColorMapUv:``,n.specularIntensityMapUv?`#define SPECULAR_INTENSITYMAP_UV `+n.specularIntensityMapUv:``,n.transmissionMapUv?`#define TRANSMISSIONMAP_UV `+n.transmissionMapUv:``,n.thicknessMapUv?`#define THICKNESSMAP_UV `+n.thicknessMapUv:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexNormals?`#define HAS_NORMAL`:``,n.vertexColors?`#define USE_COLOR`:``,n.vertexAlphas?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.flatShading?`#define FLAT_SHADED`:``,n.skinning?`#define USE_SKINNING`:``,n.morphTargets?`#define USE_MORPHTARGETS`:``,n.morphNormals&&n.flatShading===!1?`#define USE_MORPHNORMALS`:``,n.morphColors?`#define USE_MORPHCOLORS`:``,n.morphTargetsCount>0?`#define MORPHTARGETS_TEXTURE_STRIDE `+n.morphTextureStride:``,n.morphTargetsCount>0?`#define MORPHTARGETS_COUNT `+n.morphTargetsCount:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.sizeAttenuation?`#define USE_SIZEATTENUATION`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 modelMatrix;`,`uniform mat4 modelViewMatrix;`,`uniform mat4 projectionMatrix;`,`uniform mat4 viewMatrix;`,`uniform mat3 normalMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,`#ifdef USE_INSTANCING`,`	attribute mat4 instanceMatrix;`,`#endif`,`#ifdef USE_INSTANCING_COLOR`,`	attribute vec3 instanceColor;`,`#endif`,`#ifdef USE_INSTANCING_MORPH`,`	uniform sampler2D morphTexture;`,`#endif`,`attribute vec3 position;`,`attribute vec3 normal;`,`attribute vec2 uv;`,`#ifdef USE_UV1`,`	attribute vec2 uv1;`,`#endif`,`#ifdef USE_UV2`,`	attribute vec2 uv2;`,`#endif`,`#ifdef USE_UV3`,`	attribute vec2 uv3;`,`#endif`,`#ifdef USE_TANGENT`,`	attribute vec4 tangent;`,`#endif`,`#if defined( USE_COLOR_ALPHA )`,`	attribute vec4 color;`,`#elif defined( USE_COLOR )`,`	attribute vec3 color;`,`#endif`,`#ifdef USE_SKINNING`,`	attribute vec4 skinIndex;`,`	attribute vec4 skinWeight;`,`#endif`,`
`].filter(e_).join(`
`),_=[u_(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.alphaToCoverage?`#define ALPHA_TO_COVERAGE`:``,n.map?`#define USE_MAP`:``,n.matcap?`#define USE_MATCAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+l:``,n.envMap?`#define `+u:``,n.envMap?`#define `+d:``,f?`#define CUBEUV_TEXEL_WIDTH `+f.texelWidth:``,f?`#define CUBEUV_TEXEL_HEIGHT `+f.texelHeight:``,f?`#define CUBEUV_MAX_MIP `+f.maxMip+`.0`:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.packedNormalMap?`#define USE_PACKED_NORMALMAP`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoat?`#define USE_CLEARCOAT`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.dispersion?`#define USE_DISPERSION`:``,n.iridescence?`#define USE_IRIDESCENCE`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaTest?`#define USE_ALPHATEST`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.sheen?`#define USE_SHEEN`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexColors||n.instancingColor?`#define USE_COLOR`:``,n.vertexAlphas||n.batchingColor?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.gradientMap?`#define USE_GRADIENTMAP`:``,n.flatShading?`#define FLAT_SHADED`:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.premultipliedAlpha?`#define PREMULTIPLIED_ALPHA`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.numLightProbeGrids>0?`#define USE_LIGHT_PROBES_GRID`:``,n.decodeVideoTexture?`#define DECODE_VIDEO_TEXTURE`:``,n.decodeVideoTextureEmissive?`#define DECODE_VIDEO_TEXTURE_EMISSIVE`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 viewMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,n.toneMapping===0?``:`#define TONE_MAPPING`,n.toneMapping===0?``:Km.tonemapping_pars_fragment,n.toneMapping===0?``:Jg(`toneMapping`,n.toneMapping),n.dithering?`#define DITHERING`:``,n.opaque?`#define OPAQUE`:``,Km.colorspace_pars_fragment,Kg(`linearToOutputTexel`,n.outputColorSpace),Xg(),n.useDepthPacking?`#define DEPTH_PACKING `+n.depthPacking:``,`
`].filter(e_).join(`
`)),o=i_(o),o=t_(o,n),o=n_(o,n),s=i_(s),s=t_(s,n),s=n_(s,n),o=c_(o),s=c_(s),n.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,g=[p,`#define attribute in`,`#define varying out`,`#define texture2D texture`].join(`
`)+`
`+g,_=[`#define varying in`,n.glslVersion===`300 es`?``:`layout(location = 0) out highp vec4 pc_fragColor;`,n.glslVersion===`300 es`?``:`#define gl_FragColor pc_fragColor`,`#define gl_FragDepthEXT gl_FragDepth`,`#define texture2D texture`,`#define textureCube texture`,`#define texture2DProj textureProj`,`#define texture2DLodEXT textureLod`,`#define texture2DProjLodEXT textureProjLod`,`#define textureCubeLodEXT textureLod`,`#define texture2DGradEXT textureGrad`,`#define texture2DProjGradEXT textureProjGrad`,`#define textureCubeGradEXT textureGrad`].join(`
`)+`
`+_);let y=v+g+o,b=v+_+s,x=zg(i,i.VERTEX_SHADER,y),S=zg(i,i.FRAGMENT_SHADER,b);i.attachShader(h,x),i.attachShader(h,S),n.index0AttributeName===void 0?n.hasPositionAttribute===!0&&i.bindAttribLocation(h,0,`position`):i.bindAttribLocation(h,0,n.index0AttributeName),i.linkProgram(h);function C(t){if(e.debug.checkShaderErrors){let n=i.getProgramInfoLog(h)||``,r=i.getShaderInfoLog(x)||``,a=i.getShaderInfoLog(S)||``,o=n.trim(),s=r.trim(),c=a.trim(),l=!0,u=!0;if(i.getProgramParameter(h,i.LINK_STATUS)===!1)if(l=!1,typeof e.debug.onShaderError==`function`)e.debug.onShaderError(i,h,x,S);else{let e=Gg(i,x,`vertex`),n=Gg(i,S,`fragment`);ll(`WebGLProgram: Shader Error `+i.getError()+` - VALIDATE_STATUS `+i.getProgramParameter(h,i.VALIDATE_STATUS)+`

Material Name: `+t.name+`
Material Type: `+t.type+`

Program Info Log: `+o+`
`+e+`
`+n)}else o===``?(s===``||c===``)&&(u=!1):X(`WebGLProgram: Program Info Log:`,o);u&&(t.diagnostics={runnable:l,programLog:o,vertexShader:{log:s,prefix:g},fragmentShader:{log:c,prefix:_}})}i.deleteShader(x),i.deleteShader(S),w=new Rg(i,h),T=$g(i,h)}let w;this.getUniforms=function(){return w===void 0&&C(this),w};let T;this.getAttributes=function(){return T===void 0&&C(this),T};let E=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return E===!1&&(E=i.getProgramParameter(h,Bg)),E},this.destroy=function(){r.releaseStatesOfProgram(this),i.deleteProgram(h),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=Vg++,this.cacheKey=t,this.usedTimes=1,this.program=h,this.vertexShader=x,this.fragmentShader=S,this}var x_=0,S_=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e,t,n){let r=this._getShaderCacheForMaterial(e);return r.has(t)===!1&&(r.add(t),t.usedTimes++),r.has(n)===!1&&(r.add(n),n.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let e of t)e.usedTimes--,e.usedTimes===0&&this.shaderCache.delete(e.code);return this.materialCache.delete(e),this}getVertexShaderStage(e){return this._getShaderStage(e.vertexShader)}getFragmentShaderStage(e){return this._getShaderStage(e.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new C_(e),t.set(e,n)),n}},C_=class{constructor(e){this.id=x_++,this.code=e,this.usedTimes=0}};function w_(e){return e===1030||e===37490||e===36285}function T_(e,t,n,r,i,a){let o=new Su,s=new S_,c=new Set,l=[],u=new Map,d=r.logarithmicDepthBuffer,f=r.precision,p={MeshDepthMaterial:`depth`,MeshDistanceMaterial:`distance`,MeshNormalMaterial:`normal`,MeshBasicMaterial:`basic`,MeshLambertMaterial:`lambert`,MeshPhongMaterial:`phong`,MeshToonMaterial:`toon`,MeshStandardMaterial:`physical`,MeshPhysicalMaterial:`physical`,MeshMatcapMaterial:`matcap`,LineBasicMaterial:`basic`,LineDashedMaterial:`dashed`,PointsMaterial:`points`,ShadowMaterial:`shadow`,SpriteMaterial:`sprite`};function m(e){return c.add(e),e===0?`uv`:`uv${e}`}function h(i,o,l,u,h,g){let _=u.fog,v=h.geometry,y=i.isMeshStandardMaterial||i.isMeshLambertMaterial||i.isMeshPhongMaterial?u.environment:null,b=i.isMeshStandardMaterial||i.isMeshLambertMaterial&&!i.envMap||i.isMeshPhongMaterial&&!i.envMap,x=t.get(i.envMap||y,b),S=x&&x.mapping===306?x.image.height:null,C=p[i.type];i.precision!==null&&(f=r.getMaxPrecision(i.precision),f!==i.precision&&X(`WebGLProgram.getParameters:`,i.precision,`not supported, using`,f,`instead.`));let w=v.morphAttributes.position||v.morphAttributes.normal||v.morphAttributes.color,T=w===void 0?0:w.length,E=0;v.morphAttributes.position!==void 0&&(E=1),v.morphAttributes.normal!==void 0&&(E=2),v.morphAttributes.color!==void 0&&(E=3);let D,O,ee,k;if(C){let e=qm[C];D=e.vertexShader,O=e.fragmentShader}else{D=i.vertexShader,O=i.fragmentShader;let e=s.getVertexShaderStage(i),t=s.getFragmentShaderStage(i);s.update(i,e,t),ee=e.id,k=t.id}let te=e.getRenderTarget(),ne=e.state.buffers.depth.getReversed(),A=h.isInstancedMesh===!0,re=h.isBatchedMesh===!0,ie=!!i.map,ae=!!i.matcap,oe=!!x,j=!!i.aoMap,se=!!i.lightMap,ce=!!i.bumpMap&&i.wireframe===!1,le=!!i.normalMap,M=!!i.displacementMap,ue=!!i.emissiveMap,de=!!i.metalnessMap,fe=!!i.roughnessMap,pe=i.anisotropy>0,me=i.clearcoat>0,he=i.dispersion>0,ge=i.iridescence>0,_e=i.sheen>0,ve=i.transmission>0,ye=pe&&!!i.anisotropyMap,be=me&&!!i.clearcoatMap,N=me&&!!i.clearcoatNormalMap,xe=me&&!!i.clearcoatRoughnessMap,P=ge&&!!i.iridescenceMap,Se=ge&&!!i.iridescenceThicknessMap,F=_e&&!!i.sheenColorMap,Ce=_e&&!!i.sheenRoughnessMap,we=!!i.specularMap,Te=!!i.specularColorMap,I=!!i.specularIntensityMap,Ee=ve&&!!i.transmissionMap,L=ve&&!!i.thicknessMap,De=!!i.gradientMap,Oe=!!i.alphaMap,R=i.alphaTest>0,ke=!!i.alphaHash,z=!!i.extensions,Ae=0;i.toneMapped&&(te===null||te.isXRRenderTarget===!0)&&(Ae=e.toneMapping);let je={shaderID:C,shaderType:i.type,shaderName:i.name,vertexShader:D,fragmentShader:O,defines:i.defines,customVertexShaderID:ee,customFragmentShaderID:k,isRawShaderMaterial:i.isRawShaderMaterial===!0,glslVersion:i.glslVersion,precision:f,batching:re,batchingColor:re&&h._colorsTexture!==null,instancing:A,instancingColor:A&&h.instanceColor!==null,instancingMorph:A&&h.morphTexture!==null,outputColorSpace:te===null?e.outputColorSpace:te.isXRRenderTarget===!0?te.texture.colorSpace:Yl.workingColorSpace,alphaToCoverage:!!i.alphaToCoverage,map:ie,matcap:ae,envMap:oe,envMapMode:oe&&x.mapping,envMapCubeUVHeight:S,aoMap:j,lightMap:se,bumpMap:ce,normalMap:le,displacementMap:M,emissiveMap:ue,normalMapObjectSpace:le&&i.normalMapType===1,normalMapTangentSpace:le&&i.normalMapType===0,packedNormalMap:le&&i.normalMapType===0&&w_(i.normalMap.format),metalnessMap:de,roughnessMap:fe,anisotropy:pe,anisotropyMap:ye,clearcoat:me,clearcoatMap:be,clearcoatNormalMap:N,clearcoatRoughnessMap:xe,dispersion:he,iridescence:ge,iridescenceMap:P,iridescenceThicknessMap:Se,sheen:_e,sheenColorMap:F,sheenRoughnessMap:Ce,specularMap:we,specularColorMap:Te,specularIntensityMap:I,transmission:ve,transmissionMap:Ee,thicknessMap:L,gradientMap:De,opaque:i.transparent===!1&&i.blending===1&&i.alphaToCoverage===!1,alphaMap:Oe,alphaTest:R,alphaHash:ke,combine:i.combine,mapUv:ie&&m(i.map.channel),aoMapUv:j&&m(i.aoMap.channel),lightMapUv:se&&m(i.lightMap.channel),bumpMapUv:ce&&m(i.bumpMap.channel),normalMapUv:le&&m(i.normalMap.channel),displacementMapUv:M&&m(i.displacementMap.channel),emissiveMapUv:ue&&m(i.emissiveMap.channel),metalnessMapUv:de&&m(i.metalnessMap.channel),roughnessMapUv:fe&&m(i.roughnessMap.channel),anisotropyMapUv:ye&&m(i.anisotropyMap.channel),clearcoatMapUv:be&&m(i.clearcoatMap.channel),clearcoatNormalMapUv:N&&m(i.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:xe&&m(i.clearcoatRoughnessMap.channel),iridescenceMapUv:P&&m(i.iridescenceMap.channel),iridescenceThicknessMapUv:Se&&m(i.iridescenceThicknessMap.channel),sheenColorMapUv:F&&m(i.sheenColorMap.channel),sheenRoughnessMapUv:Ce&&m(i.sheenRoughnessMap.channel),specularMapUv:we&&m(i.specularMap.channel),specularColorMapUv:Te&&m(i.specularColorMap.channel),specularIntensityMapUv:I&&m(i.specularIntensityMap.channel),transmissionMapUv:Ee&&m(i.transmissionMap.channel),thicknessMapUv:L&&m(i.thicknessMap.channel),alphaMapUv:Oe&&m(i.alphaMap.channel),vertexTangents:!!v.attributes.tangent&&(le||pe),vertexNormals:!!v.attributes.normal,vertexColors:i.vertexColors,vertexAlphas:i.vertexColors===!0&&!!v.attributes.color&&v.attributes.color.itemSize===4,pointsUvs:h.isPoints===!0&&!!v.attributes.uv&&(ie||Oe),fog:!!_,useFog:i.fog===!0,fogExp2:!!_&&_.isFogExp2,flatShading:i.wireframe===!1&&(i.flatShading===!0||v.attributes.normal===void 0&&le===!1&&(i.isMeshLambertMaterial||i.isMeshPhongMaterial||i.isMeshStandardMaterial||i.isMeshPhysicalMaterial)),sizeAttenuation:i.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:ne,skinning:h.isSkinnedMesh===!0,hasPositionAttribute:v.attributes.position!==void 0,morphTargets:v.morphAttributes.position!==void 0,morphNormals:v.morphAttributes.normal!==void 0,morphColors:v.morphAttributes.color!==void 0,morphTargetsCount:T,morphTextureStride:E,numDirLights:o.directional.length,numPointLights:o.point.length,numSpotLights:o.spot.length,numSpotLightMaps:o.spotLightMap.length,numRectAreaLights:o.rectArea.length,numHemiLights:o.hemi.length,numDirLightShadows:o.directionalShadowMap.length,numPointLightShadows:o.pointShadowMap.length,numSpotLightShadows:o.spotShadowMap.length,numSpotLightShadowsWithMaps:o.numSpotLightShadowsWithMaps,numLightProbes:o.numLightProbes,numLightProbeGrids:g.length,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:i.dithering,shadowMapEnabled:e.shadowMap.enabled&&l.length>0,shadowMapType:e.shadowMap.type,toneMapping:Ae,decodeVideoTexture:ie&&i.map.isVideoTexture===!0&&Yl.getTransfer(i.map.colorSpace)===`srgb`,decodeVideoTextureEmissive:ue&&i.emissiveMap.isVideoTexture===!0&&Yl.getTransfer(i.emissiveMap.colorSpace)===`srgb`,premultipliedAlpha:i.premultipliedAlpha,doubleSided:i.side===2,flipSided:i.side===1,useDepthPacking:i.depthPacking>=0,depthPacking:i.depthPacking||0,index0AttributeName:i.index0AttributeName,extensionClipCullDistance:z&&i.extensions.clipCullDistance===!0&&n.has(`WEBGL_clip_cull_distance`),extensionMultiDraw:(z&&i.extensions.multiDraw===!0||re)&&n.has(`WEBGL_multi_draw`),rendererExtensionParallelShaderCompile:n.has(`KHR_parallel_shader_compile`),customProgramCacheKey:i.customProgramCacheKey()};return je.vertexUv1s=c.has(1),je.vertexUv2s=c.has(2),je.vertexUv3s=c.has(3),c.clear(),je}function g(t){let n=[];if(t.shaderID?n.push(t.shaderID):(n.push(t.customVertexShaderID),n.push(t.customFragmentShaderID)),t.defines!==void 0)for(let e in t.defines)n.push(e),n.push(t.defines[e]);return t.isRawShaderMaterial===!1&&(_(n,t),v(n,t),n.push(e.outputColorSpace)),n.push(t.customProgramCacheKey),n.join()}function _(e,t){e.push(t.precision),e.push(t.outputColorSpace),e.push(t.envMapMode),e.push(t.envMapCubeUVHeight),e.push(t.mapUv),e.push(t.alphaMapUv),e.push(t.lightMapUv),e.push(t.aoMapUv),e.push(t.bumpMapUv),e.push(t.normalMapUv),e.push(t.displacementMapUv),e.push(t.emissiveMapUv),e.push(t.metalnessMapUv),e.push(t.roughnessMapUv),e.push(t.anisotropyMapUv),e.push(t.clearcoatMapUv),e.push(t.clearcoatNormalMapUv),e.push(t.clearcoatRoughnessMapUv),e.push(t.iridescenceMapUv),e.push(t.iridescenceThicknessMapUv),e.push(t.sheenColorMapUv),e.push(t.sheenRoughnessMapUv),e.push(t.specularMapUv),e.push(t.specularColorMapUv),e.push(t.specularIntensityMapUv),e.push(t.transmissionMapUv),e.push(t.thicknessMapUv),e.push(t.combine),e.push(t.fogExp2),e.push(t.sizeAttenuation),e.push(t.morphTargetsCount),e.push(t.morphAttributeCount),e.push(t.numDirLights),e.push(t.numPointLights),e.push(t.numSpotLights),e.push(t.numSpotLightMaps),e.push(t.numHemiLights),e.push(t.numRectAreaLights),e.push(t.numDirLightShadows),e.push(t.numPointLightShadows),e.push(t.numSpotLightShadows),e.push(t.numSpotLightShadowsWithMaps),e.push(t.numLightProbes),e.push(t.shadowMapType),e.push(t.toneMapping),e.push(t.numClippingPlanes),e.push(t.numClipIntersection),e.push(t.depthPacking)}function v(e,t){o.disableAll(),t.instancing&&o.enable(0),t.instancingColor&&o.enable(1),t.instancingMorph&&o.enable(2),t.matcap&&o.enable(3),t.envMap&&o.enable(4),t.normalMapObjectSpace&&o.enable(5),t.normalMapTangentSpace&&o.enable(6),t.clearcoat&&o.enable(7),t.iridescence&&o.enable(8),t.alphaTest&&o.enable(9),t.vertexColors&&o.enable(10),t.vertexAlphas&&o.enable(11),t.vertexUv1s&&o.enable(12),t.vertexUv2s&&o.enable(13),t.vertexUv3s&&o.enable(14),t.vertexTangents&&o.enable(15),t.anisotropy&&o.enable(16),t.alphaHash&&o.enable(17),t.batching&&o.enable(18),t.dispersion&&o.enable(19),t.batchingColor&&o.enable(20),t.gradientMap&&o.enable(21),t.packedNormalMap&&o.enable(22),t.vertexNormals&&o.enable(23),e.push(o.mask),o.disableAll(),t.fog&&o.enable(0),t.useFog&&o.enable(1),t.flatShading&&o.enable(2),t.logarithmicDepthBuffer&&o.enable(3),t.reversedDepthBuffer&&o.enable(4),t.skinning&&o.enable(5),t.morphTargets&&o.enable(6),t.morphNormals&&o.enable(7),t.morphColors&&o.enable(8),t.premultipliedAlpha&&o.enable(9),t.shadowMapEnabled&&o.enable(10),t.doubleSided&&o.enable(11),t.flipSided&&o.enable(12),t.useDepthPacking&&o.enable(13),t.dithering&&o.enable(14),t.transmission&&o.enable(15),t.sheen&&o.enable(16),t.opaque&&o.enable(17),t.pointsUvs&&o.enable(18),t.decodeVideoTexture&&o.enable(19),t.decodeVideoTextureEmissive&&o.enable(20),t.alphaToCoverage&&o.enable(21),t.numLightProbeGrids>0&&o.enable(22),t.hasPositionAttribute&&o.enable(23),e.push(o.mask)}function y(e){let t=p[e.type],n;if(t){let e=qm[t];n=Np.clone(e.uniforms)}else n=e.uniforms;return n}function b(t,n){let r=u.get(n);return r===void 0?(r=new b_(e,n,t,i),l.push(r),u.set(n,r)):++r.usedTimes,r}function x(e){if(--e.usedTimes===0){let t=l.indexOf(e);l[t]=l[l.length-1],l.pop(),u.delete(e.cacheKey),e.destroy()}}function S(e){s.remove(e)}function C(){s.dispose()}return{getParameters:h,getProgramCacheKey:g,getUniforms:y,acquireProgram:b,releaseProgram:x,releaseShaderCache:S,programs:l,dispose:C}}function E_(){let e=new WeakMap;function t(t){return e.has(t)}function n(t){let n=e.get(t);return n===void 0&&(n={},e.set(t,n)),n}function r(t){e.delete(t)}function i(t,n,r){e.get(t)[n]=r}function a(){e=new WeakMap}return{has:t,get:n,remove:r,update:i,dispose:a}}function D_(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.material.id===t.material.id?e.materialVariant===t.materialVariant?e.z===t.z?e.id-t.id:e.z-t.z:e.materialVariant-t.materialVariant:e.material.id-t.material.id:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function O_(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.z===t.z?e.id-t.id:t.z-e.z:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function k_(){let e=[],t=0,n=[],r=[],i=[];function a(){t=0,n.length=0,r.length=0,i.length=0}function o(e){let t=0;return e.isInstancedMesh&&(t+=2),e.isSkinnedMesh&&(t+=1),t}function s(n,r,i,a,s,c){let l=e[t];return l===void 0?(l={id:n.id,object:n,geometry:r,material:i,materialVariant:o(n),groupOrder:a,renderOrder:n.renderOrder,z:s,group:c},e[t]=l):(l.id=n.id,l.object=n,l.geometry=r,l.material=i,l.materialVariant=o(n),l.groupOrder=a,l.renderOrder=n.renderOrder,l.z=s,l.group=c),t++,l}function c(e,t,a,o,c,l){let u=s(e,t,a,o,c,l);a.transmission>0?r.push(u):a.transparent===!0?i.push(u):n.push(u)}function l(e,t,a,o,c,l){let u=s(e,t,a,o,c,l);a.transmission>0?r.unshift(u):a.transparent===!0?i.unshift(u):n.unshift(u)}function u(e,t,a){n.length>1&&n.sort(e||D_),r.length>1&&r.sort(t||O_),i.length>1&&i.sort(t||O_),a&&(n.reverse(),r.reverse(),i.reverse())}function d(){for(let n=t,r=e.length;n<r;n++){let t=e[n];if(t.id===null)break;t.id=null,t.object=null,t.geometry=null,t.material=null,t.group=null}}return{opaque:n,transmissive:r,transparent:i,init:a,push:c,unshift:l,finish:d,sort:u}}function A_(){let e=new WeakMap;function t(t,n){let r=e.get(t),i;return r===void 0?(i=new k_,e.set(t,[i])):n>=r.length?(i=new k_,r.push(i)):i=r[n],i}function n(){e=new WeakMap}return{get:t,dispose:n}}function j_(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`DirectionalLight`:n={direction:new Q,color:new Ku};break;case`SpotLight`:n={position:new Q,direction:new Q,color:new Ku,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case`PointLight`:n={position:new Q,color:new Ku,distance:0,decay:0};break;case`HemisphereLight`:n={direction:new Q,skyColor:new Ku,groundColor:new Ku};break;case`RectAreaLight`:n={color:new Ku,position:new Q,halfWidth:new Q,halfHeight:new Q};break}return e[t.id]=n,n}}}function M_(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`DirectionalLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Z};break;case`SpotLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Z};break;case`PointLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Z,shadowCameraNear:1,shadowCameraFar:1e3};break}return e[t.id]=n,n}}}var N_=0;function P_(e,t){return(t.castShadow?2:0)-(e.castShadow?2:0)+ +!!t.map-!!e.map}function F_(e){let t=new j_,n=M_(),r={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let e=0;e<9;e++)r.probe.push(new Q);let i=new Q,a=new du,o=new du;function s(i){let a=0,o=0,s=0;for(let e=0;e<9;e++)r.probe[e].set(0,0,0);let c=0,l=0,u=0,d=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0;i.sort(P_);for(let e=0,y=i.length;e<y;e++){let y=i[e],b=y.color,x=y.intensity,S=y.distance,C=null;if(y.shadow&&y.shadow.map&&(C=y.shadow.map.texture.format===1030?y.shadow.map.texture:y.shadow.map.depthTexture||y.shadow.map.texture),y.isAmbientLight)a+=b.r*x,o+=b.g*x,s+=b.b*x;else if(y.isLightProbe){for(let e=0;e<9;e++)r.probe[e].addScaledVector(y.sh.coefficients[e],x);v++}else if(y.isDirectionalLight){let e=t.get(y);if(e.color.copy(y.color).multiplyScalar(y.intensity),y.castShadow){let e=y.shadow,t=n.get(y);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,r.directionalShadow[c]=t,r.directionalShadowMap[c]=C,r.directionalShadowMatrix[c]=y.shadow.matrix,p++}r.directional[c]=e,c++}else if(y.isSpotLight){let e=t.get(y);e.position.setFromMatrixPosition(y.matrixWorld),e.color.copy(b).multiplyScalar(x),e.distance=S,e.coneCos=Math.cos(y.angle),e.penumbraCos=Math.cos(y.angle*(1-y.penumbra)),e.decay=y.decay,r.spot[u]=e;let i=y.shadow;if(y.map&&(r.spotLightMap[g]=y.map,g++,i.updateMatrices(y),y.castShadow&&_++),r.spotLightMatrix[u]=i.matrix,y.castShadow){let e=n.get(y);e.shadowIntensity=i.intensity,e.shadowBias=i.bias,e.shadowNormalBias=i.normalBias,e.shadowRadius=i.radius,e.shadowMapSize=i.mapSize,r.spotShadow[u]=e,r.spotShadowMap[u]=C,h++}u++}else if(y.isRectAreaLight){let e=t.get(y);e.color.copy(b).multiplyScalar(x),e.halfWidth.set(y.width*.5,0,0),e.halfHeight.set(0,y.height*.5,0),r.rectArea[d]=e,d++}else if(y.isPointLight){let e=t.get(y);if(e.color.copy(y.color).multiplyScalar(y.intensity),e.distance=y.distance,e.decay=y.decay,y.castShadow){let e=y.shadow,t=n.get(y);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,t.shadowCameraNear=e.camera.near,t.shadowCameraFar=e.camera.far,r.pointShadow[l]=t,r.pointShadowMap[l]=C,r.pointShadowMatrix[l]=y.shadow.matrix,m++}r.point[l]=e,l++}else if(y.isHemisphereLight){let e=t.get(y);e.skyColor.copy(y.color).multiplyScalar(x),e.groundColor.copy(y.groundColor).multiplyScalar(x),r.hemi[f]=e,f++}}d>0&&(e.has(`OES_texture_float_linear`)===!0?(r.rectAreaLTC1=$.LTC_FLOAT_1,r.rectAreaLTC2=$.LTC_FLOAT_2):(r.rectAreaLTC1=$.LTC_HALF_1,r.rectAreaLTC2=$.LTC_HALF_2)),r.ambient[0]=a,r.ambient[1]=o,r.ambient[2]=s;let y=r.hash;(y.directionalLength!==c||y.pointLength!==l||y.spotLength!==u||y.rectAreaLength!==d||y.hemiLength!==f||y.numDirectionalShadows!==p||y.numPointShadows!==m||y.numSpotShadows!==h||y.numSpotMaps!==g||y.numLightProbes!==v)&&(r.directional.length=c,r.spot.length=u,r.rectArea.length=d,r.point.length=l,r.hemi.length=f,r.directionalShadow.length=p,r.directionalShadowMap.length=p,r.pointShadow.length=m,r.pointShadowMap.length=m,r.spotShadow.length=h,r.spotShadowMap.length=h,r.directionalShadowMatrix.length=p,r.pointShadowMatrix.length=m,r.spotLightMatrix.length=h+g-_,r.spotLightMap.length=g,r.numSpotLightShadowsWithMaps=_,r.numLightProbes=v,y.directionalLength=c,y.pointLength=l,y.spotLength=u,y.rectAreaLength=d,y.hemiLength=f,y.numDirectionalShadows=p,y.numPointShadows=m,y.numSpotShadows=h,y.numSpotMaps=g,y.numLightProbes=v,r.version=N_++)}function c(e,t){let n=0,s=0,c=0,l=0,u=0,d=t.matrixWorldInverse;for(let t=0,f=e.length;t<f;t++){let f=e[t];if(f.isDirectionalLight){let e=r.directional[n];e.direction.setFromMatrixPosition(f.matrixWorld),i.setFromMatrixPosition(f.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(d),n++}else if(f.isSpotLight){let e=r.spot[c];e.position.setFromMatrixPosition(f.matrixWorld),e.position.applyMatrix4(d),e.direction.setFromMatrixPosition(f.matrixWorld),i.setFromMatrixPosition(f.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(d),c++}else if(f.isRectAreaLight){let e=r.rectArea[l];e.position.setFromMatrixPosition(f.matrixWorld),e.position.applyMatrix4(d),o.identity(),a.copy(f.matrixWorld),a.premultiply(d),o.extractRotation(a),e.halfWidth.set(f.width*.5,0,0),e.halfHeight.set(0,f.height*.5,0),e.halfWidth.applyMatrix4(o),e.halfHeight.applyMatrix4(o),l++}else if(f.isPointLight){let e=r.point[s];e.position.setFromMatrixPosition(f.matrixWorld),e.position.applyMatrix4(d),s++}else if(f.isHemisphereLight){let e=r.hemi[u];e.direction.setFromMatrixPosition(f.matrixWorld),e.direction.transformDirection(d),u++}}}return{setup:s,setupView:c,state:r}}function I_(e){let t=new F_(e),n=[],r=[],i=[];function a(e){d.camera=e,n.length=0,r.length=0,i.length=0}function o(e){n.push(e)}function s(e){r.push(e)}function c(e){i.push(e)}function l(){t.setup(n)}function u(e){t.setupView(n,e)}let d={lightsArray:n,shadowsArray:r,lightProbeGridArray:i,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:a,state:d,setupLights:l,setupLightsView:u,pushLight:o,pushShadow:s,pushLightProbeGrid:c}}function L_(e){let t=new WeakMap;function n(n,r=0){let i=t.get(n),a;return i===void 0?(a=new I_(e),t.set(n,[a])):r>=i.length?(a=new I_(e),i.push(a)):a=i[r],a}function r(){t=new WeakMap}return{get:n,dispose:r}}var R_=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,z_=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,B_=[new Q(1,0,0),new Q(-1,0,0),new Q(0,1,0),new Q(0,-1,0),new Q(0,0,1),new Q(0,0,-1)],V_=[new Q(0,-1,0),new Q(0,-1,0),new Q(0,0,1),new Q(0,0,-1),new Q(0,-1,0),new Q(0,-1,0)],H_=new du,U_=new Q,W_=new Q;function G_(e,t,n){let r=new Nf,i=new Z,a=new Z,o=new ou,s=new Bp,c=new Vp,l={},u=n.maxTextureSize,d={0:1,1:0,2:2},f=new Ip({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Z},radius:{value:4}},vertexShader:R_,fragmentShader:z_}),p=f.clone();p.defines.HORIZONTAL_PASS=1;let m=new Ud;m.setAttribute(`position`,new Od(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let h=new pf(m,f),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=1;let _=this.type;this.render=function(t,n,s){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||t.length===0)return;this.type===2&&(X(`WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.`),this.type=1);let c=e.getRenderTarget(),l=e.getActiveCubeFace(),d=e.getActiveMipmapLevel(),f=e.state;f.setBlending(0),f.buffers.depth.getReversed()===!0?f.buffers.color.setClear(0,0,0,0):f.buffers.color.setClear(1,1,1,1),f.buffers.depth.setTest(!0),f.setScissorTest(!1);let p=_!==this.type;p&&n.traverse(function(e){e.material&&(Array.isArray(e.material)?e.material.forEach(e=>e.needsUpdate=!0):e.material.needsUpdate=!0)});for(let c=0,l=t.length;c<l;c++){let l=t[c],d=l.shadow;if(d===void 0){X(`WebGLShadowMap:`,l,`has no shadow.`);continue}if(d.autoUpdate===!1&&d.needsUpdate===!1)continue;i.copy(d.mapSize);let m=d.getFrameExtents();i.multiply(m),a.copy(d.mapSize),(i.x>u||i.y>u)&&(i.x>u&&(a.x=Math.floor(u/m.x),i.x=a.x*m.x,d.mapSize.x=a.x),i.y>u&&(a.y=Math.floor(u/m.y),i.y=a.y*m.y,d.mapSize.y=a.y));let h=e.state.buffers.depth.getReversed();if(d.camera._reversedDepth=h,d.map===null||p===!0){if(d.map!==null&&(d.map.depthTexture!==null&&(d.map.depthTexture.dispose(),d.map.depthTexture=null),d.map.dispose()),this.type===3){if(l.isPointLight){X(`WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.`);continue}d.map=new cu(i.x,i.y,{format:tc,type:Hs,minFilter:Ms,magFilter:Ms,generateMipmaps:!1}),d.map.texture.name=l.name+`.shadowMap`,d.map.depthTexture=new Uf(i.x,i.y,Vs),d.map.depthTexture.name=l.name+`.shadowMapDepth`,d.map.depthTexture.format=Zs,d.map.depthTexture.compareFunction=null,d.map.depthTexture.minFilter=ks,d.map.depthTexture.magFilter=ks}else l.isPointLight?(d.map=new Sh(i.x),d.map.depthTexture=new Wf(i.x,Bs)):(d.map=new cu(i.x,i.y),d.map.depthTexture=new Uf(i.x,i.y,Bs)),d.map.depthTexture.name=l.name+`.shadowMap`,d.map.depthTexture.format=Zs,this.type===1?(d.map.depthTexture.compareFunction=h?518:515,d.map.depthTexture.minFilter=Ms,d.map.depthTexture.magFilter=Ms):(d.map.depthTexture.compareFunction=null,d.map.depthTexture.minFilter=ks,d.map.depthTexture.magFilter=ks);d.camera.updateProjectionMatrix()}let g=d.map.isWebGLCubeRenderTarget?6:1;for(let t=0;t<g;t++){if(d.map.isWebGLCubeRenderTarget)e.setRenderTarget(d.map,t),e.clear();else{t===0&&(e.setRenderTarget(d.map),e.clear());let n=d.getViewport(t);o.set(a.x*n.x,a.y*n.y,a.x*n.z,a.y*n.w),f.viewport(o)}if(l.isPointLight){let e=d.camera,n=d.matrix,r=l.distance||e.far;r!==e.far&&(e.far=r,e.updateProjectionMatrix()),U_.setFromMatrixPosition(l.matrixWorld),e.position.copy(U_),W_.copy(e.position),W_.add(B_[t]),e.up.copy(V_[t]),e.lookAt(W_),e.updateMatrixWorld(),n.makeTranslation(-U_.x,-U_.y,-U_.z),H_.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),d._frustum.setFromProjectionMatrix(H_,e.coordinateSystem,e.reversedDepth)}else d.updateMatrices(l);r=d.getFrustum(),b(n,s,d.camera,l,this.type)}d.isPointLightShadow!==!0&&this.type===3&&v(d,s),d.needsUpdate=!1}_=this.type,g.needsUpdate=!1,e.setRenderTarget(c,l,d)};function v(n,r){let a=t.update(h);f.defines.VSM_SAMPLES!==n.blurSamples&&(f.defines.VSM_SAMPLES=n.blurSamples,p.defines.VSM_SAMPLES=n.blurSamples,f.needsUpdate=!0,p.needsUpdate=!0),n.mapPass===null&&(n.mapPass=new cu(i.x,i.y,{format:tc,type:Hs})),f.uniforms.shadow_pass.value=n.map.depthTexture,f.uniforms.resolution.value=n.mapSize,f.uniforms.radius.value=n.radius,e.setRenderTarget(n.mapPass),e.clear(),e.renderBufferDirect(r,null,a,f,h,null),p.uniforms.shadow_pass.value=n.mapPass.texture,p.uniforms.resolution.value=n.mapSize,p.uniforms.radius.value=n.radius,e.setRenderTarget(n.map),e.clear(),e.renderBufferDirect(r,null,a,p,h,null)}function y(t,n,r,i){let a=null,o=r.isPointLight===!0?t.customDistanceMaterial:t.customDepthMaterial;if(o!==void 0)a=o;else if(a=r.isPointLight===!0?c:s,e.localClippingEnabled&&n.clipShadows===!0&&Array.isArray(n.clippingPlanes)&&n.clippingPlanes.length!==0||n.displacementMap&&n.displacementScale!==0||n.alphaMap&&n.alphaTest>0||n.map&&n.alphaTest>0||n.alphaToCoverage===!0){let e=a.uuid,t=n.uuid,r=l[e];r===void 0&&(r={},l[e]=r);let i=r[t];i===void 0&&(i=a.clone(),r[t]=i,n.addEventListener(`dispose`,x)),a=i}if(a.visible=n.visible,a.wireframe=n.wireframe,i===3?a.side=n.shadowSide===null?n.side:n.shadowSide:a.side=n.shadowSide===null?d[n.side]:n.shadowSide,a.alphaMap=n.alphaMap,a.alphaTest=n.alphaToCoverage===!0?.5:n.alphaTest,a.map=n.map,a.clipShadows=n.clipShadows,a.clippingPlanes=n.clippingPlanes,a.clipIntersection=n.clipIntersection,a.displacementMap=n.displacementMap,a.displacementScale=n.displacementScale,a.displacementBias=n.displacementBias,a.wireframeLinewidth=n.wireframeLinewidth,a.linewidth=n.linewidth,r.isPointLight===!0&&a.isMeshDistanceMaterial===!0){let t=e.properties.get(a);t.light=r}return a}function b(n,i,a,o,s){if(n.visible===!1)return;if(n.layers.test(i.layers)&&(n.isMesh||n.isLine||n.isPoints)&&(n.castShadow||n.receiveShadow&&s===3)&&(!n.frustumCulled||r.intersectsObject(n))){n.modelViewMatrix.multiplyMatrices(a.matrixWorldInverse,n.matrixWorld);let r=t.update(n),c=n.material;if(Array.isArray(c)){let t=r.groups;for(let l=0,u=t.length;l<u;l++){let u=t[l],d=c[u.materialIndex];if(d&&d.visible){let t=y(n,d,o,s);n.onBeforeShadow(e,n,i,a,r,t,u),e.renderBufferDirect(a,null,r,t,n,u),n.onAfterShadow(e,n,i,a,r,t,u)}}}else if(c.visible){let t=y(n,c,o,s);n.onBeforeShadow(e,n,i,a,r,t,null),e.renderBufferDirect(a,null,r,t,n,null),n.onAfterShadow(e,n,i,a,r,t,null)}}let c=n.children;for(let e=0,t=c.length;e<t;e++)b(c[e],i,a,o,s)}function x(e){e.target.removeEventListener(`dispose`,x);for(let t in l){let n=l[t],r=e.target.uuid;r in n&&(n[r].dispose(),delete n[r])}}}function K_(e,t){function n(){let t=!1,n=new ou,r=null,i=new ou(0,0,0,0);return{setMask:function(n){r!==n&&!t&&(e.colorMask(n,n,n,n),r=n)},setLocked:function(e){t=e},setClear:function(t,r,a,o,s){s===!0&&(t*=o,r*=o,a*=o),n.set(t,r,a,o),i.equals(n)===!1&&(e.clearColor(t,r,a,o),i.copy(n))},reset:function(){t=!1,r=null,i.set(-1,0,0,0)}}}function r(){let n=!1,r=!1,i=null,a=null,o=null;return{setReversed:function(e){if(r!==e){let n=t.get(`EXT_clip_control`);e?n.clipControlEXT(n.LOWER_LEFT_EXT,n.ZERO_TO_ONE_EXT):n.clipControlEXT(n.LOWER_LEFT_EXT,n.NEGATIVE_ONE_TO_ONE_EXT),r=e;let i=o;o=null,this.setClear(i)}},getReversed:function(){return r},setTest:function(t){t?de(e.DEPTH_TEST):fe(e.DEPTH_TEST)},setMask:function(t){i!==t&&!n&&(e.depthMask(t),i=t)},setFunc:function(t){if(r&&(t=fl[t]),a!==t){switch(t){case 0:e.depthFunc(e.NEVER);break;case 1:e.depthFunc(e.ALWAYS);break;case 2:e.depthFunc(e.LESS);break;case 3:e.depthFunc(e.LEQUAL);break;case 4:e.depthFunc(e.EQUAL);break;case 5:e.depthFunc(e.GEQUAL);break;case 6:e.depthFunc(e.GREATER);break;case 7:e.depthFunc(e.NOTEQUAL);break;default:e.depthFunc(e.LEQUAL)}a=t}},setLocked:function(e){n=e},setClear:function(t){o!==t&&(o=t,r&&(t=1-t),e.clearDepth(t))},reset:function(){n=!1,i=null,a=null,o=null,r=!1}}}function i(){let t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null;return{setTest:function(n){t||(n?de(e.STENCIL_TEST):fe(e.STENCIL_TEST))},setMask:function(r){n!==r&&!t&&(e.stencilMask(r),n=r)},setFunc:function(t,n,o){(r!==t||i!==n||a!==o)&&(e.stencilFunc(t,n,o),r=t,i=n,a=o)},setOp:function(t,n,r){(o!==t||s!==n||c!==r)&&(e.stencilOp(t,n,r),o=t,s=n,c=r)},setLocked:function(e){t=e},setClear:function(t){l!==t&&(e.clearStencil(t),l=t)},reset:function(){t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null}}}let a=new n,o=new r,s=new i,c=new WeakMap,l=new WeakMap,u={},d={},f={},p=new WeakMap,m=[],h=null,g=!1,_=null,v=null,y=null,b=null,x=null,S=null,C=null,w=new Ku(0,0,0),T=0,E=!1,D=null,O=null,ee=null,k=null,te=null,ne=e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS),A=!1,re=0,ie=e.getParameter(e.VERSION);ie.indexOf(`WebGL`)===-1?ie.indexOf(`OpenGL ES`)!==-1&&(re=parseFloat(/^OpenGL ES (\d)/.exec(ie)[1]),A=re>=2):(re=parseFloat(/^WebGL (\d)/.exec(ie)[1]),A=re>=1);let ae=null,oe={},j=e.getParameter(e.SCISSOR_BOX),se=e.getParameter(e.VIEWPORT),ce=new ou().fromArray(j),le=new ou().fromArray(se);function M(t,n,r,i){let a=new Uint8Array(4),o=e.createTexture();e.bindTexture(t,o),e.texParameteri(t,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(t,e.TEXTURE_MAG_FILTER,e.NEAREST);for(let o=0;o<r;o++)t===e.TEXTURE_3D||t===e.TEXTURE_2D_ARRAY?e.texImage3D(n,0,e.RGBA,1,1,i,0,e.RGBA,e.UNSIGNED_BYTE,a):e.texImage2D(n+o,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,a);return o}let ue={};ue[e.TEXTURE_2D]=M(e.TEXTURE_2D,e.TEXTURE_2D,1),ue[e.TEXTURE_CUBE_MAP]=M(e.TEXTURE_CUBE_MAP,e.TEXTURE_CUBE_MAP_POSITIVE_X,6),ue[e.TEXTURE_2D_ARRAY]=M(e.TEXTURE_2D_ARRAY,e.TEXTURE_2D_ARRAY,1,1),ue[e.TEXTURE_3D]=M(e.TEXTURE_3D,e.TEXTURE_3D,1,1),a.setClear(0,0,0,1),o.setClear(1),s.setClear(0),de(e.DEPTH_TEST),o.setFunc(3),be(!1),N(1),de(e.CULL_FACE),ve(0);function de(t){u[t]!==!0&&(e.enable(t),u[t]=!0)}function fe(t){u[t]!==!1&&(e.disable(t),u[t]=!1)}function pe(t,n){return f[t]===n?!1:(e.bindFramebuffer(t,n),f[t]=n,t===e.DRAW_FRAMEBUFFER&&(f[e.FRAMEBUFFER]=n),t===e.FRAMEBUFFER&&(f[e.DRAW_FRAMEBUFFER]=n),!0)}function me(t,n){let r=m,i=!1;if(t){r=p.get(n),r===void 0&&(r=[],p.set(n,r));let a=t.textures;if(r.length!==a.length||r[0]!==e.COLOR_ATTACHMENT0){for(let t=0,n=a.length;t<n;t++)r[t]=e.COLOR_ATTACHMENT0+t;r.length=a.length,i=!0}}else r[0]!==e.BACK&&(r[0]=e.BACK,i=!0);i&&e.drawBuffers(r)}function he(t){return h===t?!1:(e.useProgram(t),h=t,!0)}let ge={100:e.FUNC_ADD,101:e.FUNC_SUBTRACT,102:e.FUNC_REVERSE_SUBTRACT};ge[103]=e.MIN,ge[104]=e.MAX;let _e={200:e.ZERO,201:e.ONE,202:e.SRC_COLOR,204:e.SRC_ALPHA,210:e.SRC_ALPHA_SATURATE,208:e.DST_COLOR,206:e.DST_ALPHA,203:e.ONE_MINUS_SRC_COLOR,205:e.ONE_MINUS_SRC_ALPHA,209:e.ONE_MINUS_DST_COLOR,207:e.ONE_MINUS_DST_ALPHA,211:e.CONSTANT_COLOR,212:e.ONE_MINUS_CONSTANT_COLOR,213:e.CONSTANT_ALPHA,214:e.ONE_MINUS_CONSTANT_ALPHA};function ve(t,n,r,i,a,o,s,c,l,u){if(t===0){g===!0&&(fe(e.BLEND),g=!1);return}if(g===!1&&(de(e.BLEND),g=!0),t!==5){if(t!==_||u!==E){if((v!==100||x!==100)&&(e.blendEquation(e.FUNC_ADD),v=100,x=100),u)switch(t){case 1:e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFunc(e.ONE,e.ONE);break;case 3:e.blendFuncSeparate(e.ZERO,e.ONE_MINUS_SRC_COLOR,e.ZERO,e.ONE);break;case 4:e.blendFuncSeparate(e.DST_COLOR,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE);break;default:ll(`WebGLState: Invalid blending: `,t);break}else switch(t){case 1:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE,e.ONE,e.ONE);break;case 3:ll(`WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true`);break;case 4:ll(`WebGLState: MultiplyBlending requires material.premultipliedAlpha = true`);break;default:ll(`WebGLState: Invalid blending: `,t);break}y=null,b=null,S=null,C=null,w.set(0,0,0),T=0,_=t,E=u}return}a||=n,o||=r,s||=i,(n!==v||a!==x)&&(e.blendEquationSeparate(ge[n],ge[a]),v=n,x=a),(r!==y||i!==b||o!==S||s!==C)&&(e.blendFuncSeparate(_e[r],_e[i],_e[o],_e[s]),y=r,b=i,S=o,C=s),(c.equals(w)===!1||l!==T)&&(e.blendColor(c.r,c.g,c.b,l),w.copy(c),T=l),_=t,E=!1}function ye(t,n){t.side===2?fe(e.CULL_FACE):de(e.CULL_FACE);let r=t.side===1;n&&(r=!r),be(r),t.blending===1&&t.transparent===!1?ve(0):ve(t.blending,t.blendEquation,t.blendSrc,t.blendDst,t.blendEquationAlpha,t.blendSrcAlpha,t.blendDstAlpha,t.blendColor,t.blendAlpha,t.premultipliedAlpha),o.setFunc(t.depthFunc),o.setTest(t.depthTest),o.setMask(t.depthWrite),a.setMask(t.colorWrite);let i=t.stencilWrite;s.setTest(i),i&&(s.setMask(t.stencilWriteMask),s.setFunc(t.stencilFunc,t.stencilRef,t.stencilFuncMask),s.setOp(t.stencilFail,t.stencilZFail,t.stencilZPass)),P(t.polygonOffset,t.polygonOffsetFactor,t.polygonOffsetUnits),t.alphaToCoverage===!0?de(e.SAMPLE_ALPHA_TO_COVERAGE):fe(e.SAMPLE_ALPHA_TO_COVERAGE)}function be(t){D!==t&&(t?e.frontFace(e.CW):e.frontFace(e.CCW),D=t)}function N(t){t===0?fe(e.CULL_FACE):(de(e.CULL_FACE),t!==O&&(t===1?e.cullFace(e.BACK):t===2?e.cullFace(e.FRONT):e.cullFace(e.FRONT_AND_BACK))),O=t}function xe(t){t!==ee&&(A&&e.lineWidth(t),ee=t)}function P(t,n,r){t?(de(e.POLYGON_OFFSET_FILL),(k!==n||te!==r)&&(k=n,te=r,o.getReversed()&&(n=-n),e.polygonOffset(n,r))):fe(e.POLYGON_OFFSET_FILL)}function Se(t){t?de(e.SCISSOR_TEST):fe(e.SCISSOR_TEST)}function F(t){t===void 0&&(t=e.TEXTURE0+ne-1),ae!==t&&(e.activeTexture(t),ae=t)}function Ce(t,n,r){r===void 0&&(r=ae===null?e.TEXTURE0+ne-1:ae);let i=oe[r];i===void 0&&(i={type:void 0,texture:void 0},oe[r]=i),(i.type!==t||i.texture!==n)&&(ae!==r&&(e.activeTexture(r),ae=r),e.bindTexture(t,n||ue[t]),i.type=t,i.texture=n)}function we(){let t=oe[ae];t!==void 0&&t.type!==void 0&&(e.bindTexture(t.type,null),t.type=void 0,t.texture=void 0)}function Te(){try{e.compressedTexImage2D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function I(){try{e.compressedTexImage3D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function Ee(){try{e.texSubImage2D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function L(){try{e.texSubImage3D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function De(){try{e.compressedTexSubImage2D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function Oe(){try{e.compressedTexSubImage3D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function R(){try{e.texStorage2D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function ke(){try{e.texStorage3D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function z(){try{e.texImage2D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function Ae(){try{e.texImage3D(...arguments)}catch(e){ll(`WebGLState:`,e)}}function je(t){return d[t]===void 0?e.getParameter(t):d[t]}function Me(t,n){d[t]!==n&&(e.pixelStorei(t,n),d[t]=n)}function Ne(t){ce.equals(t)===!1&&(e.scissor(t.x,t.y,t.z,t.w),ce.copy(t))}function Pe(t){le.equals(t)===!1&&(e.viewport(t.x,t.y,t.z,t.w),le.copy(t))}function Fe(t,n){let r=l.get(n);r===void 0&&(r=new WeakMap,l.set(n,r));let i=r.get(t);i===void 0&&(i=e.getUniformBlockIndex(n,t.name),r.set(t,i))}function Ie(t,n){let r=l.get(n).get(t);c.get(n)!==r&&(e.uniformBlockBinding(n,r,t.__bindingPointIndex),c.set(n,r))}function Le(){e.disable(e.BLEND),e.disable(e.CULL_FACE),e.disable(e.DEPTH_TEST),e.disable(e.POLYGON_OFFSET_FILL),e.disable(e.SCISSOR_TEST),e.disable(e.STENCIL_TEST),e.disable(e.SAMPLE_ALPHA_TO_COVERAGE),e.blendEquation(e.FUNC_ADD),e.blendFunc(e.ONE,e.ZERO),e.blendFuncSeparate(e.ONE,e.ZERO,e.ONE,e.ZERO),e.blendColor(0,0,0,0),e.colorMask(!0,!0,!0,!0),e.clearColor(0,0,0,0),e.depthMask(!0),e.depthFunc(e.LESS),o.setReversed(!1),e.clearDepth(1),e.stencilMask(4294967295),e.stencilFunc(e.ALWAYS,0,4294967295),e.stencilOp(e.KEEP,e.KEEP,e.KEEP),e.clearStencil(0),e.cullFace(e.BACK),e.frontFace(e.CCW),e.polygonOffset(0,0),e.activeTexture(e.TEXTURE0),e.bindFramebuffer(e.FRAMEBUFFER,null),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),e.bindFramebuffer(e.READ_FRAMEBUFFER,null),e.useProgram(null),e.lineWidth(1),e.scissor(0,0,e.canvas.width,e.canvas.height),e.viewport(0,0,e.canvas.width,e.canvas.height),e.pixelStorei(e.PACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,e.BROWSER_DEFAULT_WEBGL),e.pixelStorei(e.PACK_ROW_LENGTH,0),e.pixelStorei(e.PACK_SKIP_PIXELS,0),e.pixelStorei(e.PACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_ROW_LENGTH,0),e.pixelStorei(e.UNPACK_IMAGE_HEIGHT,0),e.pixelStorei(e.UNPACK_SKIP_PIXELS,0),e.pixelStorei(e.UNPACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_SKIP_IMAGES,0),u={},d={},ae=null,oe={},f={},p=new WeakMap,m=[],h=null,g=!1,_=null,v=null,y=null,b=null,x=null,S=null,C=null,w=new Ku(0,0,0),T=0,E=!1,D=null,O=null,ee=null,k=null,te=null,ce.set(0,0,e.canvas.width,e.canvas.height),le.set(0,0,e.canvas.width,e.canvas.height),a.reset(),o.reset(),s.reset()}return{buffers:{color:a,depth:o,stencil:s},enable:de,disable:fe,bindFramebuffer:pe,drawBuffers:me,useProgram:he,setBlending:ve,setMaterial:ye,setFlipSided:be,setCullFace:N,setLineWidth:xe,setPolygonOffset:P,setScissorTest:Se,activeTexture:F,bindTexture:Ce,unbindTexture:we,compressedTexImage2D:Te,compressedTexImage3D:I,texImage2D:z,texImage3D:Ae,pixelStorei:Me,getParameter:je,updateUBOMapping:Fe,uniformBlockBinding:Ie,texStorage2D:R,texStorage3D:ke,texSubImage2D:Ee,texSubImage3D:L,compressedTexSubImage2D:De,compressedTexSubImage3D:Oe,scissor:Ne,viewport:Pe,reset:Le}}function q_(e,t,n,r,i,a,o){let s=t.has(`WEBGL_multisampled_render_to_texture`)?t.get(`WEBGL_multisampled_render_to_texture`):null,c=typeof navigator>`u`?!1:/OculusBrowser/g.test(navigator.userAgent),l=new Z,u=new WeakMap,d=new Set,f,p=new WeakMap,m=!1;try{m=typeof OffscreenCanvas<`u`&&new OffscreenCanvas(1,1).getContext(`2d`)!==null}catch{}function h(e,t){return m?new OffscreenCanvas(e,t):il(`canvas`)}function g(e,t,n){let r=1,i=Te(e);if((i.width>n||i.height>n)&&(r=n/Math.max(i.width,i.height)),r<1)if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap||typeof VideoFrame<`u`&&e instanceof VideoFrame){let n=Math.floor(r*i.width),a=Math.floor(r*i.height);f===void 0&&(f=h(n,a));let o=t?h(n,a):f;return o.width=n,o.height=a,o.getContext(`2d`).drawImage(e,0,0,n,a),X(`WebGLRenderer: Texture has been resized from (`+i.width+`x`+i.height+`) to (`+n+`x`+a+`).`),o}else return`data`in e&&X(`WebGLRenderer: Image in DataTexture is too big (`+i.width+`x`+i.height+`).`),e;return e}function _(e){return e.generateMipmaps}function v(t){e.generateMipmap(t)}function y(t){return t.isWebGLCubeRenderTarget?e.TEXTURE_CUBE_MAP:t.isWebGL3DRenderTarget?e.TEXTURE_3D:t.isWebGLArrayRenderTarget||t.isCompressedArrayTexture?e.TEXTURE_2D_ARRAY:e.TEXTURE_2D}function b(n,r,i,a,o,s=!1){if(n!==null){if(e[n]!==void 0)return e[n];X(`WebGLRenderer: Attempt to use non-existing WebGL internal format '`+n+`'`)}let c;a&&(c=t.get(`EXT_texture_norm16`),c||X(`WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension`));let l=r;if(r===e.RED&&(i===e.FLOAT&&(l=e.R32F),i===e.HALF_FLOAT&&(l=e.R16F),i===e.UNSIGNED_BYTE&&(l=e.R8),i===e.UNSIGNED_SHORT&&c&&(l=c.R16_EXT),i===e.SHORT&&c&&(l=c.R16_SNORM_EXT)),r===e.RED_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.R8UI),i===e.UNSIGNED_SHORT&&(l=e.R16UI),i===e.UNSIGNED_INT&&(l=e.R32UI),i===e.BYTE&&(l=e.R8I),i===e.SHORT&&(l=e.R16I),i===e.INT&&(l=e.R32I)),r===e.RG&&(i===e.FLOAT&&(l=e.RG32F),i===e.HALF_FLOAT&&(l=e.RG16F),i===e.UNSIGNED_BYTE&&(l=e.RG8),i===e.UNSIGNED_SHORT&&c&&(l=c.RG16_EXT),i===e.SHORT&&c&&(l=c.RG16_SNORM_EXT)),r===e.RG_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RG8UI),i===e.UNSIGNED_SHORT&&(l=e.RG16UI),i===e.UNSIGNED_INT&&(l=e.RG32UI),i===e.BYTE&&(l=e.RG8I),i===e.SHORT&&(l=e.RG16I),i===e.INT&&(l=e.RG32I)),r===e.RGB_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RGB8UI),i===e.UNSIGNED_SHORT&&(l=e.RGB16UI),i===e.UNSIGNED_INT&&(l=e.RGB32UI),i===e.BYTE&&(l=e.RGB8I),i===e.SHORT&&(l=e.RGB16I),i===e.INT&&(l=e.RGB32I)),r===e.RGBA_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RGBA8UI),i===e.UNSIGNED_SHORT&&(l=e.RGBA16UI),i===e.UNSIGNED_INT&&(l=e.RGBA32UI),i===e.BYTE&&(l=e.RGBA8I),i===e.SHORT&&(l=e.RGBA16I),i===e.INT&&(l=e.RGBA32I)),r===e.RGB&&(i===e.UNSIGNED_SHORT&&c&&(l=c.RGB16_EXT),i===e.SHORT&&c&&(l=c.RGB16_SNORM_EXT),i===e.UNSIGNED_INT_5_9_9_9_REV&&(l=e.RGB9_E5),i===e.UNSIGNED_INT_10F_11F_11F_REV&&(l=e.R11F_G11F_B10F)),r===e.RGBA){let t=s?Xc:Yl.getTransfer(o);i===e.FLOAT&&(l=e.RGBA32F),i===e.HALF_FLOAT&&(l=e.RGBA16F),i===e.UNSIGNED_BYTE&&(l=t===`srgb`?e.SRGB8_ALPHA8:e.RGBA8),i===e.UNSIGNED_SHORT&&c&&(l=c.RGBA16_EXT),i===e.SHORT&&c&&(l=c.RGBA16_SNORM_EXT),i===e.UNSIGNED_SHORT_4_4_4_4&&(l=e.RGBA4),i===e.UNSIGNED_SHORT_5_5_5_1&&(l=e.RGB5_A1)}return(l===e.R16F||l===e.R32F||l===e.RG16F||l===e.RG32F||l===e.RGBA16F||l===e.RGBA32F)&&t.get(`EXT_color_buffer_float`),l}function x(t,n){let r;return t?n===null||n===1014||n===1020?r=e.DEPTH24_STENCIL8:n===1015?r=e.DEPTH32F_STENCIL8:n===1012&&(r=e.DEPTH24_STENCIL8,X(`DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.`)):n===null||n===1014||n===1020?r=e.DEPTH_COMPONENT24:n===1015?r=e.DEPTH_COMPONENT32F:n===1012&&(r=e.DEPTH_COMPONENT16),r}function S(e,t){return _(e)===!0||e.isFramebufferTexture&&e.minFilter!==1003&&e.minFilter!==1006?Math.log2(Math.max(t.width,t.height))+1:e.mipmaps!==void 0&&e.mipmaps.length>0?e.mipmaps.length:e.isCompressedTexture&&Array.isArray(e.image)?t.mipmaps.length:1}function C(e){let t=e.target;t.removeEventListener(`dispose`,C),T(t),t.isVideoTexture&&u.delete(t),t.isHTMLTexture&&d.delete(t)}function w(e){let t=e.target;t.removeEventListener(`dispose`,w),D(t)}function T(e){let t=r.get(e);if(t.__webglInit===void 0)return;let n=e.source,i=p.get(n);if(i){let r=i[t.__cacheKey];r.usedTimes--,r.usedTimes===0&&E(e),Object.keys(i).length===0&&p.delete(n)}r.remove(e)}function E(t){let n=r.get(t);e.deleteTexture(n.__webglTexture);let i=t.source,a=p.get(i);delete a[n.__cacheKey],o.memory.textures--}function D(t){let n=r.get(t);if(t.depthTexture&&(t.depthTexture.dispose(),r.remove(t.depthTexture)),t.isWebGLCubeRenderTarget)for(let t=0;t<6;t++){if(Array.isArray(n.__webglFramebuffer[t]))for(let r=0;r<n.__webglFramebuffer[t].length;r++)e.deleteFramebuffer(n.__webglFramebuffer[t][r]);else e.deleteFramebuffer(n.__webglFramebuffer[t]);n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer[t])}else{if(Array.isArray(n.__webglFramebuffer))for(let t=0;t<n.__webglFramebuffer.length;t++)e.deleteFramebuffer(n.__webglFramebuffer[t]);else e.deleteFramebuffer(n.__webglFramebuffer);if(n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer),n.__webglMultisampledFramebuffer&&e.deleteFramebuffer(n.__webglMultisampledFramebuffer),n.__webglColorRenderbuffer)for(let t=0;t<n.__webglColorRenderbuffer.length;t++)n.__webglColorRenderbuffer[t]&&e.deleteRenderbuffer(n.__webglColorRenderbuffer[t]);n.__webglDepthRenderbuffer&&e.deleteRenderbuffer(n.__webglDepthRenderbuffer)}let i=t.textures;for(let t=0,n=i.length;t<n;t++){let n=r.get(i[t]);n.__webglTexture&&(e.deleteTexture(n.__webglTexture),o.memory.textures--),r.remove(i[t])}r.remove(t)}let O=0;function ee(){O=0}function k(){return O}function te(e){O=e}function ne(){let e=O;return e>=i.maxTextures&&X(`WebGLTextures: Trying to use `+e+` texture units while this GPU supports only `+i.maxTextures),O+=1,e}function A(e){let t=[];return t.push(e.wrapS),t.push(e.wrapT),t.push(e.wrapR||0),t.push(e.magFilter),t.push(e.minFilter),t.push(e.anisotropy),t.push(e.internalFormat),t.push(e.format),t.push(e.type),t.push(e.generateMipmaps),t.push(e.premultiplyAlpha),t.push(e.flipY),t.push(e.unpackAlignment),t.push(e.colorSpace),t.join()}function re(t,i){let a=r.get(t);if(t.isVideoTexture&&Ce(t),t.isRenderTargetTexture===!1&&t.isExternalTexture!==!0&&t.version>0&&a.__version!==t.version){let e=t.image;if(e===null)X(`WebGLRenderer: Texture marked for update but no image data found.`);else if(e.complete===!1)X(`WebGLRenderer: Texture marked for update but image is incomplete`);else{fe(a,t,i);return}}else t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null);n.bindTexture(e.TEXTURE_2D,a.__webglTexture,e.TEXTURE0+i)}function ie(t,i){let a=r.get(t);if(t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version){fe(a,t,i);return}else t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null);n.bindTexture(e.TEXTURE_2D_ARRAY,a.__webglTexture,e.TEXTURE0+i)}function ae(t,i){let a=r.get(t);if(t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version){fe(a,t,i);return}n.bindTexture(e.TEXTURE_3D,a.__webglTexture,e.TEXTURE0+i)}function oe(t,i){let a=r.get(t);if(t.isCubeDepthTexture!==!0&&t.version>0&&a.__version!==t.version){pe(a,t,i);return}n.bindTexture(e.TEXTURE_CUBE_MAP,a.__webglTexture,e.TEXTURE0+i)}let j={[Es]:e.REPEAT,[Ds]:e.CLAMP_TO_EDGE,[Os]:e.MIRRORED_REPEAT},se={[ks]:e.NEAREST,[As]:e.NEAREST_MIPMAP_NEAREST,[js]:e.NEAREST_MIPMAP_LINEAR,[Ms]:e.LINEAR,[Ns]:e.LINEAR_MIPMAP_NEAREST,[Ps]:e.LINEAR_MIPMAP_LINEAR},ce={512:e.NEVER,519:e.ALWAYS,513:e.LESS,515:e.LEQUAL,514:e.EQUAL,518:e.GEQUAL,516:e.GREATER,517:e.NOTEQUAL};function le(n,a){if(a.type===1015&&t.has(`OES_texture_float_linear`)===!1&&(a.magFilter===1006||a.magFilter===1007||a.magFilter===1005||a.magFilter===1008||a.minFilter===1006||a.minFilter===1007||a.minFilter===1005||a.minFilter===1008)&&X(`WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device.`),e.texParameteri(n,e.TEXTURE_WRAP_S,j[a.wrapS]),e.texParameteri(n,e.TEXTURE_WRAP_T,j[a.wrapT]),(n===e.TEXTURE_3D||n===e.TEXTURE_2D_ARRAY)&&e.texParameteri(n,e.TEXTURE_WRAP_R,j[a.wrapR]),e.texParameteri(n,e.TEXTURE_MAG_FILTER,se[a.magFilter]),e.texParameteri(n,e.TEXTURE_MIN_FILTER,se[a.minFilter]),a.compareFunction&&(e.texParameteri(n,e.TEXTURE_COMPARE_MODE,e.COMPARE_REF_TO_TEXTURE),e.texParameteri(n,e.TEXTURE_COMPARE_FUNC,ce[a.compareFunction])),t.has(`EXT_texture_filter_anisotropic`)===!0){if(a.magFilter===1003||a.minFilter!==1005&&a.minFilter!==1008||a.type===1015&&t.has(`OES_texture_float_linear`)===!1)return;if(a.anisotropy>1||r.get(a).__currentAnisotropy){let o=t.get(`EXT_texture_filter_anisotropic`);e.texParameterf(n,o.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(a.anisotropy,i.getMaxAnisotropy())),r.get(a).__currentAnisotropy=a.anisotropy}}}function M(t,n){let r=!1;t.__webglInit===void 0&&(t.__webglInit=!0,n.addEventListener(`dispose`,C));let i=n.source,a=p.get(i);a===void 0&&(a={},p.set(i,a));let s=A(n);if(s!==t.__cacheKey){a[s]===void 0&&(a[s]={texture:e.createTexture(),usedTimes:0},o.memory.textures++,r=!0),a[s].usedTimes++;let i=a[t.__cacheKey];i!==void 0&&(a[t.__cacheKey].usedTimes--,i.usedTimes===0&&E(n)),t.__cacheKey=s,t.__webglTexture=a[s].texture}return r}function ue(e,t,n){return Math.floor(Math.floor(e/n)/t)}function de(t,r,i,a){let o=t.updateRanges;if(o.length===0)n.texSubImage2D(e.TEXTURE_2D,0,0,0,r.width,r.height,i,a,r.data);else{o.sort((e,t)=>e.start-t.start);let s=0;for(let e=1;e<o.length;e++){let t=o[s],n=o[e],i=t.start+t.count,a=ue(n.start,r.width,4),c=ue(t.start,r.width,4);n.start<=i+1&&a===c&&ue(n.start+n.count-1,r.width,4)===a?t.count=Math.max(t.count,n.start+n.count-t.start):(++s,o[s]=n)}o.length=s+1;let c=n.getParameter(e.UNPACK_ROW_LENGTH),l=n.getParameter(e.UNPACK_SKIP_PIXELS),u=n.getParameter(e.UNPACK_SKIP_ROWS);n.pixelStorei(e.UNPACK_ROW_LENGTH,r.width);for(let t=0,s=o.length;t<s;t++){let s=o[t],c=Math.floor(s.start/4),l=Math.ceil(s.count/4),u=c%r.width,d=Math.floor(c/r.width),f=l;n.pixelStorei(e.UNPACK_SKIP_PIXELS,u),n.pixelStorei(e.UNPACK_SKIP_ROWS,d),n.texSubImage2D(e.TEXTURE_2D,0,u,d,f,1,i,a,r.data)}t.clearUpdateRanges(),n.pixelStorei(e.UNPACK_ROW_LENGTH,c),n.pixelStorei(e.UNPACK_SKIP_PIXELS,l),n.pixelStorei(e.UNPACK_SKIP_ROWS,u)}}function fe(t,o,s){let c=e.TEXTURE_2D;(o.isDataArrayTexture||o.isCompressedArrayTexture)&&(c=e.TEXTURE_2D_ARRAY),o.isData3DTexture&&(c=e.TEXTURE_3D);let l=M(t,o),u=o.source;n.bindTexture(c,t.__webglTexture,e.TEXTURE0+s);let f=r.get(u);if(u.version!==f.__version||l===!0){if(n.activeTexture(e.TEXTURE0+s),!(typeof ImageBitmap<`u`&&o.image instanceof ImageBitmap)){let t=Yl.getPrimaries(Yl.workingColorSpace),r=o.colorSpace===``?null:Yl.getPrimaries(o.colorSpace),i=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,i)}n.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment);let t=g(o.image,!1,i.maxTextureSize);t=we(o,t);let r=a.convert(o.format,o.colorSpace),p=a.convert(o.type),m=b(o.internalFormat,r,p,o.normalized,o.colorSpace,o.isVideoTexture);le(c,o);let h,y=o.mipmaps,C=o.isVideoTexture!==!0,w=f.__version===void 0||l===!0,T=u.dataReady,E=S(o,t);if(o.isDepthTexture)m=x(o.format===Qs,o.type),w&&(C?n.texStorage2D(e.TEXTURE_2D,1,m,t.width,t.height):n.texImage2D(e.TEXTURE_2D,0,m,t.width,t.height,0,r,p,null));else if(o.isDataTexture)if(y.length>0){C&&w&&n.texStorage2D(e.TEXTURE_2D,E,m,y[0].width,y[0].height);for(let t=0,i=y.length;t<i;t++)h=y[t],C?T&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,p,h.data):n.texImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,r,p,h.data);o.generateMipmaps=!1}else C?(w&&n.texStorage2D(e.TEXTURE_2D,E,m,t.width,t.height),T&&de(o,t,r,p)):n.texImage2D(e.TEXTURE_2D,0,m,t.width,t.height,0,r,p,t.data);else if(o.isCompressedTexture)if(o.isCompressedArrayTexture){C&&w&&n.texStorage3D(e.TEXTURE_2D_ARRAY,E,m,y[0].width,y[0].height,t.depth);for(let i=0,a=y.length;i<a;i++)if(h=y[i],o.format!==1023)if(r!==null)if(C){if(T)if(o.layerUpdates.size>0){let t=Hm(h.width,h.height,o.format,o.type);for(let a of o.layerUpdates){let o=h.data.subarray(a*t/h.data.BYTES_PER_ELEMENT,(a+1)*t/h.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,a,h.width,h.height,1,r,o)}o.clearLayerUpdates()}else n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,0,h.width,h.height,t.depth,r,h.data)}else n.compressedTexImage3D(e.TEXTURE_2D_ARRAY,i,m,h.width,h.height,t.depth,0,h.data,0,0);else X(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`);else C?T&&n.texSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,0,h.width,h.height,t.depth,r,p,h.data):n.texImage3D(e.TEXTURE_2D_ARRAY,i,m,h.width,h.height,t.depth,0,r,p,h.data)}else{C&&w&&n.texStorage2D(e.TEXTURE_2D,E,m,y[0].width,y[0].height);for(let t=0,i=y.length;t<i;t++)h=y[t],o.format===1023?C?T&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,p,h.data):n.texImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,r,p,h.data):r===null?X(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`):C?T&&n.compressedTexSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,h.data):n.compressedTexImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,h.data)}else if(o.isDataArrayTexture)if(C){if(w&&n.texStorage3D(e.TEXTURE_2D_ARRAY,E,m,t.width,t.height,t.depth),T)if(o.layerUpdates.size>0){let i=Hm(t.width,t.height,o.format,o.type);for(let a of o.layerUpdates){let o=t.data.subarray(a*i/t.data.BYTES_PER_ELEMENT,(a+1)*i/t.data.BYTES_PER_ELEMENT);n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,a,t.width,t.height,1,r,p,o)}o.clearLayerUpdates()}else n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,0,t.width,t.height,t.depth,r,p,t.data)}else n.texImage3D(e.TEXTURE_2D_ARRAY,0,m,t.width,t.height,t.depth,0,r,p,t.data);else if(o.isData3DTexture)C?(w&&n.texStorage3D(e.TEXTURE_3D,E,m,t.width,t.height,t.depth),T&&n.texSubImage3D(e.TEXTURE_3D,0,0,0,0,t.width,t.height,t.depth,r,p,t.data)):n.texImage3D(e.TEXTURE_3D,0,m,t.width,t.height,t.depth,0,r,p,t.data);else if(o.isFramebufferTexture){if(w)if(C)n.texStorage2D(e.TEXTURE_2D,E,m,t.width,t.height);else{let i=t.width,a=t.height;for(let t=0;t<E;t++)n.texImage2D(e.TEXTURE_2D,t,m,i,a,0,r,p,null),i>>=1,a>>=1}}else if(o.isHTMLTexture){if(`texElementImage2D`in e){let n=e.canvas;if(n.hasAttribute(`layoutsubtree`)||n.setAttribute(`layoutsubtree`,`true`),t.parentNode!==n){n.appendChild(t),d.add(o),n.onpaint=e=>{let t=e.changedElements;for(let e of d)t.includes(e.image)&&(e.needsUpdate=!0)},n.requestPaint();return}if(e.texElementImage2D.length===3)e.texElementImage2D(e.TEXTURE_2D,e.RGBA8,t);else{let n=e.RGBA,r=e.RGBA,i=e.UNSIGNED_BYTE;e.texElementImage2D(e.TEXTURE_2D,0,n,r,i,t)}e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}}else if(y.length>0){if(C&&w){let t=Te(y[0]);n.texStorage2D(e.TEXTURE_2D,E,m,t.width,t.height)}for(let t=0,i=y.length;t<i;t++)h=y[t],C?T&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,r,p,h):n.texImage2D(e.TEXTURE_2D,t,m,r,p,h);o.generateMipmaps=!1}else if(C){if(w){let r=Te(t);n.texStorage2D(e.TEXTURE_2D,E,m,r.width,r.height)}T&&n.texSubImage2D(e.TEXTURE_2D,0,0,0,r,p,t)}else n.texImage2D(e.TEXTURE_2D,0,m,r,p,t);_(o)&&v(c),f.__version=u.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function pe(t,o,s){if(o.image.length!==6)return;let c=M(t,o),l=o.source;n.bindTexture(e.TEXTURE_CUBE_MAP,t.__webglTexture,e.TEXTURE0+s);let u=r.get(l);if(l.version!==u.__version||c===!0){n.activeTexture(e.TEXTURE0+s);let t=Yl.getPrimaries(Yl.workingColorSpace),r=o.colorSpace===``?null:Yl.getPrimaries(o.colorSpace),d=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),n.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,d);let f=o.isCompressedTexture||o.image[0].isCompressedTexture,p=o.image[0]&&o.image[0].isDataTexture,m=[];for(let e=0;e<6;e++)!f&&!p?m[e]=g(o.image[e],!0,i.maxCubemapSize):m[e]=p?o.image[e].image:o.image[e],m[e]=we(o,m[e]);let h=m[0],y=a.convert(o.format,o.colorSpace),x=a.convert(o.type),C=b(o.internalFormat,y,x,o.normalized,o.colorSpace),w=o.isVideoTexture!==!0,T=u.__version===void 0||c===!0,E=l.dataReady,D=S(o,h);le(e.TEXTURE_CUBE_MAP,o);let O;if(f){w&&T&&n.texStorage2D(e.TEXTURE_CUBE_MAP,D,C,h.width,h.height);for(let t=0;t<6;t++){O=m[t].mipmaps;for(let r=0;r<O.length;r++){let i=O[r];o.format===1023?w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,y,x,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,C,i.width,i.height,0,y,x,i.data):y===null?X(`WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()`):w?E&&n.compressedTexSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,y,i.data):n.compressedTexImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,C,i.width,i.height,0,i.data)}}}else{if(O=o.mipmaps,w&&T){O.length>0&&D++;let t=Te(m[0]);n.texStorage2D(e.TEXTURE_CUBE_MAP,D,C,t.width,t.height)}for(let t=0;t<6;t++)if(p){w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,m[t].width,m[t].height,y,x,m[t].data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,C,m[t].width,m[t].height,0,y,x,m[t].data);for(let r=0;r<O.length;r++){let i=O[r].image[t].image;w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,i.width,i.height,y,x,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,C,i.width,i.height,0,y,x,i.data)}}else{w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,y,x,m[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,C,y,x,m[t]);for(let r=0;r<O.length;r++){let i=O[r];w?E&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,y,x,i.image[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,C,y,x,i.image[t])}}}_(o)&&v(e.TEXTURE_CUBE_MAP),u.__version=l.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function me(t,i,o,c,l,u){let d=a.convert(o.format,o.colorSpace),f=a.convert(o.type),p=b(o.internalFormat,d,f,o.normalized,o.colorSpace),m=r.get(i),h=r.get(o);if(h.__renderTarget=i,!m.__hasExternalTextures){let t=Math.max(1,i.width>>u),r=Math.max(1,i.height>>u);l===e.TEXTURE_3D||l===e.TEXTURE_2D_ARRAY?n.texImage3D(l,u,p,t,r,i.depth,0,d,f,null):n.texImage2D(l,u,p,t,r,0,d,f,null)}n.bindFramebuffer(e.FRAMEBUFFER,t),F(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,c,l,h.__webglTexture,0,Se(i)):(l===e.TEXTURE_2D||l>=e.TEXTURE_CUBE_MAP_POSITIVE_X&&l<=e.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&e.framebufferTexture2D(e.FRAMEBUFFER,c,l,h.__webglTexture,u),n.bindFramebuffer(e.FRAMEBUFFER,null)}function he(t,n,r){if(e.bindRenderbuffer(e.RENDERBUFFER,t),n.depthBuffer){let i=n.depthTexture,a=i&&i.isDepthTexture?i.type:null,o=x(n.stencilBuffer,a),c=n.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;F(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,Se(n),o,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,Se(n),o,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,o,n.width,n.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,c,e.RENDERBUFFER,t)}else{let t=n.textures;for(let i=0;i<t.length;i++){let o=t[i],c=a.convert(o.format,o.colorSpace),l=a.convert(o.type),u=b(o.internalFormat,c,l,o.normalized,o.colorSpace);F(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,Se(n),u,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,Se(n),u,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,u,n.width,n.height)}}e.bindRenderbuffer(e.RENDERBUFFER,null)}function ge(t,i,o){let c=i.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(e.FRAMEBUFFER,t),!(i.depthTexture&&i.depthTexture.isDepthTexture))throw Error(`THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.`);let l=r.get(i.depthTexture);if(l.__renderTarget=i,(!l.__webglTexture||i.depthTexture.image.width!==i.width||i.depthTexture.image.height!==i.height)&&(i.depthTexture.image.width=i.width,i.depthTexture.image.height=i.height,i.depthTexture.needsUpdate=!0),c){if(l.__webglInit===void 0&&(l.__webglInit=!0,i.depthTexture.addEventListener(`dispose`,C)),l.__webglTexture===void 0){l.__webglTexture=e.createTexture(),n.bindTexture(e.TEXTURE_CUBE_MAP,l.__webglTexture),le(e.TEXTURE_CUBE_MAP,i.depthTexture);let t=a.convert(i.depthTexture.format),r=a.convert(i.depthTexture.type),o;i.depthTexture.format===1026?o=e.DEPTH_COMPONENT24:i.depthTexture.format===1027&&(o=e.DEPTH24_STENCIL8);for(let n=0;n<6;n++)e.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0,o,i.width,i.height,0,t,r,null)}}else re(i.depthTexture,0);let u=l.__webglTexture,d=Se(i),f=c?e.TEXTURE_CUBE_MAP_POSITIVE_X+o:e.TEXTURE_2D,p=i.depthTexture.format===1027?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;if(i.depthTexture.format===1026)F(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else if(i.depthTexture.format===1027)F(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else throw Error(`THREE.WebGLTextures: Unknown depthTexture format.`)}function _e(t){let i=r.get(t),a=t.isWebGLCubeRenderTarget===!0;if(i.__boundDepthTexture!==t.depthTexture){let e=t.depthTexture;if(i.__depthDisposeCallback&&i.__depthDisposeCallback(),e){let t=()=>{delete i.__boundDepthTexture,delete i.__depthDisposeCallback,e.removeEventListener(`dispose`,t)};e.addEventListener(`dispose`,t),i.__depthDisposeCallback=t}i.__boundDepthTexture=e}if(t.depthTexture&&!i.__autoAllocateDepthBuffer)if(a)for(let e=0;e<6;e++)ge(i.__webglFramebuffer[e],t,e);else{let e=t.texture.mipmaps;e&&e.length>0?ge(i.__webglFramebuffer[0],t,0):ge(i.__webglFramebuffer,t,0)}else if(a){i.__webglDepthbuffer=[];for(let r=0;r<6;r++)if(n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[r]),i.__webglDepthbuffer[r]===void 0)i.__webglDepthbuffer[r]=e.createRenderbuffer(),he(i.__webglDepthbuffer[r],t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,a=i.__webglDepthbuffer[r];e.bindRenderbuffer(e.RENDERBUFFER,a),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,a)}}else{let r=t.texture.mipmaps;if(r&&r.length>0?n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[0]):n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer),i.__webglDepthbuffer===void 0)i.__webglDepthbuffer=e.createRenderbuffer(),he(i.__webglDepthbuffer,t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,r=i.__webglDepthbuffer;e.bindRenderbuffer(e.RENDERBUFFER,r),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,r)}}n.bindFramebuffer(e.FRAMEBUFFER,null)}function ve(t,n,i){let a=r.get(t);n!==void 0&&me(a.__webglFramebuffer,t,t.texture,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,0),i!==void 0&&_e(t)}function ye(t){let i=t.texture,s=r.get(t),c=r.get(i);t.addEventListener(`dispose`,w);let l=t.textures,u=t.isWebGLCubeRenderTarget===!0,d=l.length>1;if(d||(c.__webglTexture===void 0&&(c.__webglTexture=e.createTexture()),c.__version=i.version,o.memory.textures++),u){s.__webglFramebuffer=[];for(let t=0;t<6;t++)if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer[t]=[];for(let n=0;n<i.mipmaps.length;n++)s.__webglFramebuffer[t][n]=e.createFramebuffer()}else s.__webglFramebuffer[t]=e.createFramebuffer()}else{if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer=[];for(let t=0;t<i.mipmaps.length;t++)s.__webglFramebuffer[t]=e.createFramebuffer()}else s.__webglFramebuffer=e.createFramebuffer();if(d)for(let t=0,n=l.length;t<n;t++){let n=r.get(l[t]);n.__webglTexture===void 0&&(n.__webglTexture=e.createTexture(),o.memory.textures++)}if(t.samples>0&&F(t)===!1){s.__webglMultisampledFramebuffer=e.createFramebuffer(),s.__webglColorRenderbuffer=[],n.bindFramebuffer(e.FRAMEBUFFER,s.__webglMultisampledFramebuffer);for(let n=0;n<l.length;n++){let r=l[n];s.__webglColorRenderbuffer[n]=e.createRenderbuffer(),e.bindRenderbuffer(e.RENDERBUFFER,s.__webglColorRenderbuffer[n]);let i=a.convert(r.format,r.colorSpace),o=a.convert(r.type),c=b(r.internalFormat,i,o,r.normalized,r.colorSpace,t.isXRRenderTarget===!0),u=Se(t);e.renderbufferStorageMultisample(e.RENDERBUFFER,u,c,t.width,t.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+n,e.RENDERBUFFER,s.__webglColorRenderbuffer[n])}e.bindRenderbuffer(e.RENDERBUFFER,null),t.depthBuffer&&(s.__webglDepthRenderbuffer=e.createRenderbuffer(),he(s.__webglDepthRenderbuffer,t,!0)),n.bindFramebuffer(e.FRAMEBUFFER,null)}}if(u){n.bindTexture(e.TEXTURE_CUBE_MAP,c.__webglTexture),le(e.TEXTURE_CUBE_MAP,i);for(let n=0;n<6;n++)if(i.mipmaps&&i.mipmaps.length>0)for(let r=0;r<i.mipmaps.length;r++)me(s.__webglFramebuffer[n][r],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,r);else me(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0);_(i)&&v(e.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(d){for(let i=0,a=l.length;i<a;i++){let a=l[i],o=r.get(a),c=e.TEXTURE_2D;(t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(c=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(c,o.__webglTexture),le(c,a),me(s.__webglFramebuffer,t,a,e.COLOR_ATTACHMENT0+i,c,0),_(a)&&v(c)}n.unbindTexture()}else{let r=e.TEXTURE_2D;if((t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(r=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(r,c.__webglTexture),le(r,i),i.mipmaps&&i.mipmaps.length>0)for(let n=0;n<i.mipmaps.length;n++)me(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,r,n);else me(s.__webglFramebuffer,t,i,e.COLOR_ATTACHMENT0,r,0);_(i)&&v(r),n.unbindTexture()}t.depthBuffer&&_e(t)}function be(e){let t=e.textures;for(let i=0,a=t.length;i<a;i++){let a=t[i];if(_(a)){let t=y(e),i=r.get(a).__webglTexture;n.bindTexture(t,i),v(t),n.unbindTexture()}}}let N=[],xe=[];function P(t){if(t.samples>0){if(F(t)===!1){let i=t.textures,a=t.width,o=t.height,s=e.COLOR_BUFFER_BIT,l=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,u=r.get(t),d=i.length>1;if(d)for(let t=0;t<i.length;t++)n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,null),n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,null,0);n.bindFramebuffer(e.READ_FRAMEBUFFER,u.__webglMultisampledFramebuffer);let f=t.texture.mipmaps;f&&f.length>0?n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer[0]):n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer);for(let n=0;n<i.length;n++){if(t.resolveDepthBuffer&&(t.depthBuffer&&(s|=e.DEPTH_BUFFER_BIT),t.stencilBuffer&&t.resolveStencilBuffer&&(s|=e.STENCIL_BUFFER_BIT)),d){e.framebufferRenderbuffer(e.READ_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,u.__webglColorRenderbuffer[n]);let t=r.get(i[n]).__webglTexture;e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t,0)}e.blitFramebuffer(0,0,a,o,0,0,a,o,s,e.NEAREST),c===!0&&(N.length=0,xe.length=0,N.push(e.COLOR_ATTACHMENT0+n),t.depthBuffer&&t.resolveDepthBuffer===!1&&(N.push(l),xe.push(l),e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,xe)),e.invalidateFramebuffer(e.READ_FRAMEBUFFER,N))}if(n.bindFramebuffer(e.READ_FRAMEBUFFER,null),n.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),d)for(let t=0;t<i.length;t++){n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,u.__webglColorRenderbuffer[t]);let a=r.get(i[t]).__webglTexture;n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,a,0)}n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglMultisampledFramebuffer)}else if(t.depthBuffer&&t.resolveDepthBuffer===!1&&c){let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,[n])}}}function Se(e){return Math.min(i.maxSamples,e.samples)}function F(e){let n=r.get(e);return e.samples>0&&t.has(`WEBGL_multisampled_render_to_texture`)===!0&&n.__useRenderToTexture!==!1}function Ce(e){let t=o.render.frame;u.get(e)!==t&&(u.set(e,t),e.update())}function we(e,t){let n=e.colorSpace,r=e.format,i=e.type;return e.isCompressedTexture===!0||e.isVideoTexture===!0||n!==`srgb-linear`&&n!==``&&(Yl.getTransfer(n)===`srgb`?(r!==1023||i!==1009)&&X(`WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.`):ll(`WebGLTextures: Unsupported texture color space:`,n)),t}function Te(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement?(l.width=e.naturalWidth||e.width,l.height=e.naturalHeight||e.height):typeof VideoFrame<`u`&&e instanceof VideoFrame?(l.width=e.displayWidth,l.height=e.displayHeight):(l.width=e.width,l.height=e.height),l}this.allocateTextureUnit=ne,this.resetTextureUnits=ee,this.getTextureUnits=k,this.setTextureUnits=te,this.setTexture2D=re,this.setTexture2DArray=ie,this.setTexture3D=ae,this.setTextureCube=oe,this.rebindTextures=ve,this.setupRenderTarget=ye,this.updateRenderTargetMipmap=be,this.updateMultisampleRenderTarget=P,this.setupDepthRenderbuffer=_e,this.setupFrameBufferTexture=me,this.useMultisampledRTT=F,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function J_(e,t){function n(n,r=``){let i,a=Yl.getTransfer(r);if(n===1009)return e.UNSIGNED_BYTE;if(n===1017)return e.UNSIGNED_SHORT_4_4_4_4;if(n===1018)return e.UNSIGNED_SHORT_5_5_5_1;if(n===35902)return e.UNSIGNED_INT_5_9_9_9_REV;if(n===35899)return e.UNSIGNED_INT_10F_11F_11F_REV;if(n===1010)return e.BYTE;if(n===1011)return e.SHORT;if(n===1012)return e.UNSIGNED_SHORT;if(n===1013)return e.INT;if(n===1014)return e.UNSIGNED_INT;if(n===1015)return e.FLOAT;if(n===1016)return e.HALF_FLOAT;if(n===1021)return e.ALPHA;if(n===1022)return e.RGB;if(n===1023)return e.RGBA;if(n===1026)return e.DEPTH_COMPONENT;if(n===1027)return e.DEPTH_STENCIL;if(n===1028)return e.RED;if(n===1029)return e.RED_INTEGER;if(n===1030)return e.RG;if(n===1031)return e.RG_INTEGER;if(n===1033)return e.RGBA_INTEGER;if(n===33776||n===33777||n===33778||n===33779)if(a===`srgb`)if(i=t.get(`WEBGL_compressed_texture_s3tc_srgb`),i!==null){if(n===33776)return i.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(i=t.get(`WEBGL_compressed_texture_s3tc`),i!==null){if(n===33776)return i.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===35840||n===35841||n===35842||n===35843)if(i=t.get(`WEBGL_compressed_texture_pvrtc`),i!==null){if(n===35840)return i.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===35841)return i.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===35842)return i.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===35843)return i.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===36196||n===37492||n===37496||n===37488||n===37489||n===37490||n===37491)if(i=t.get(`WEBGL_compressed_texture_etc`),i!==null){if(n===36196||n===37492)return a===`srgb`?i.COMPRESSED_SRGB8_ETC2:i.COMPRESSED_RGB8_ETC2;if(n===37496)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:i.COMPRESSED_RGBA8_ETC2_EAC;if(n===37488)return i.COMPRESSED_R11_EAC;if(n===37489)return i.COMPRESSED_SIGNED_R11_EAC;if(n===37490)return i.COMPRESSED_RG11_EAC;if(n===37491)return i.COMPRESSED_SIGNED_RG11_EAC}else return null;if(n===37808||n===37809||n===37810||n===37811||n===37812||n===37813||n===37814||n===37815||n===37816||n===37817||n===37818||n===37819||n===37820||n===37821)if(i=t.get(`WEBGL_compressed_texture_astc`),i!==null){if(n===37808)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:i.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===37809)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:i.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===37810)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:i.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===37811)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:i.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===37812)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:i.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===37813)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:i.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===37814)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:i.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===37815)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:i.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===37816)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:i.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===37817)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:i.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===37818)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:i.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===37819)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:i.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===37820)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:i.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===37821)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:i.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===36492||n===36494||n===36495)if(i=t.get(`EXT_texture_compression_bptc`),i!==null){if(n===36492)return a===`srgb`?i.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:i.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===36494)return i.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===36495)return i.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===36283||n===36284||n===36285||n===36286)if(i=t.get(`EXT_texture_compression_rgtc`),i!==null){if(n===36283)return i.COMPRESSED_RED_RGTC1_EXT;if(n===36284)return i.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===36285)return i.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===36286)return i.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===1020?e.UNSIGNED_INT_24_8:e[n]===void 0?null:e[n]}return{convert:n}}var Y_=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,X_=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,Z_=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new Gf(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new Ip({vertexShader:Y_,fragmentShader:X_,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new pf(new wp(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Q_=class extends pl{constructor(e,t){super();let n=this,r=null,i=1,a=null,o=`local-floor`,s=1,c=null,l=null,u=null,d=null,f=null,p=null,m=typeof XRWebGLBinding<`u`,h=new Z_,g={},_=t.getContextAttributes(),v=null,y=null,b=[],x=[],S=new Z,C=null,w=new _m;w.viewport=new ou;let T=new _m;T.viewport=new ou;let E=[w,T],D=new Dm,O=null,ee=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(e){let t=b[e];return t===void 0&&(t=new Vu,b[e]=t),t.getTargetRaySpace()},this.getControllerGrip=function(e){let t=b[e];return t===void 0&&(t=new Vu,b[e]=t),t.getGripSpace()},this.getHand=function(e){let t=b[e];return t===void 0&&(t=new Vu,b[e]=t),t.getHandSpace()};function k(e){let t=x.indexOf(e.inputSource);if(t===-1)return;let n=b[t];n!==void 0&&(n.update(e.inputSource,e.frame,c||a),n.dispatchEvent({type:e.type,data:e.inputSource}))}function te(){r.removeEventListener(`select`,k),r.removeEventListener(`selectstart`,k),r.removeEventListener(`selectend`,k),r.removeEventListener(`squeeze`,k),r.removeEventListener(`squeezestart`,k),r.removeEventListener(`squeezeend`,k),r.removeEventListener(`end`,te),r.removeEventListener(`inputsourceschange`,ne);for(let e=0;e<b.length;e++){let t=x[e];t!==null&&(x[e]=null,b[e].disconnect(t))}O=null,ee=null,h.reset();for(let e in g)delete g[e];e.setRenderTarget(v),f=null,d=null,u=null,r=null,y=null,ce.stop(),n.isPresenting=!1,e.setPixelRatio(C),e.setSize(S.width,S.height,!1),n.dispatchEvent({type:`sessionend`})}this.setFramebufferScaleFactor=function(e){i=e,n.isPresenting===!0&&X(`WebXRManager: Cannot change framebuffer scale while presenting.`)},this.setReferenceSpaceType=function(e){o=e,n.isPresenting===!0&&X(`WebXRManager: Cannot change reference space type while presenting.`)},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(e){c=e},this.getBaseLayer=function(){return d===null?f:d},this.getBinding=function(){return u===null&&m&&(u=new XRWebGLBinding(r,t)),u},this.getFrame=function(){return p},this.getSession=function(){return r},this.setSession=async function(l){if(r=l,r!==null){if(v=e.getRenderTarget(),r.addEventListener(`select`,k),r.addEventListener(`selectstart`,k),r.addEventListener(`selectend`,k),r.addEventListener(`squeeze`,k),r.addEventListener(`squeezestart`,k),r.addEventListener(`squeezeend`,k),r.addEventListener(`end`,te),r.addEventListener(`inputsourceschange`,ne),_.xrCompatible!==!0&&await t.makeXRCompatible(),C=e.getPixelRatio(),e.getSize(S),m&&`createProjectionLayer`in XRWebGLBinding.prototype){let n=null,a=null,o=null;_.depth&&(o=_.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,n=_.stencil?Qs:Zs,a=_.stencil?Gs:Bs);let s={colorFormat:t.RGBA8,depthFormat:o,scaleFactor:i};u=this.getBinding(),d=u.createProjectionLayer(s),r.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),y=new cu(d.textureWidth,d.textureHeight,{format:Xs,type:Fs,depthTexture:new Uf(d.textureWidth,d.textureHeight,a,void 0,void 0,void 0,void 0,void 0,void 0,n),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}else{let n={antialias:_.antialias,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:i};f=new XRWebGLLayer(r,t,n),r.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),y=new cu(f.framebufferWidth,f.framebufferHeight,{format:Xs,type:Fs,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(s),c=null,a=await r.requestReferenceSpace(o),ce.setContext(r),ce.start(),n.isPresenting=!0,n.dispatchEvent({type:`sessionstart`})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return h.getDepthTexture()};function ne(e){for(let t=0;t<e.removed.length;t++){let n=e.removed[t],r=x.indexOf(n);r>=0&&(x[r]=null,b[r].disconnect(n))}for(let t=0;t<e.added.length;t++){let n=e.added[t],r=x.indexOf(n);if(r===-1){for(let e=0;e<b.length;e++)if(e>=x.length){x.push(n),r=e;break}else if(x[e]===null){x[e]=n,r=e;break}if(r===-1)break}let i=b[r];i&&i.connect(n)}}let A=new Q,re=new Q;function ie(e,t,n){A.setFromMatrixPosition(t.matrixWorld),re.setFromMatrixPosition(n.matrixWorld);let r=A.distanceTo(re),i=t.projectionMatrix.elements,a=n.projectionMatrix.elements,o=i[14]/(i[10]-1),s=i[14]/(i[10]+1),c=(i[9]+1)/i[5],l=(i[9]-1)/i[5],u=(i[8]-1)/i[0],d=(a[8]+1)/a[0],f=o*u,p=o*d,m=r/(-u+d),h=m*-u;if(t.matrixWorld.decompose(e.position,e.quaternion,e.scale),e.translateX(h),e.translateZ(m),e.matrixWorld.compose(e.position,e.quaternion,e.scale),e.matrixWorldInverse.copy(e.matrixWorld).invert(),i[10]===-1)e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse);else{let t=o+m,n=s+m,i=f-h,a=p+(r-h),u=c*s/n*t,d=l*s/n*t;e.projectionMatrix.makePerspective(i,a,u,d,t,n),e.projectionMatrixInverse.copy(e.projectionMatrix).invert()}}function ae(e,t){t===null?e.matrixWorld.copy(e.matrix):e.matrixWorld.multiplyMatrices(t.matrixWorld,e.matrix),e.matrixWorldInverse.copy(e.matrixWorld).invert()}this.updateCamera=function(e){if(r===null)return;let t=e.near,n=e.far;h.texture!==null&&(h.depthNear>0&&(t=h.depthNear),h.depthFar>0&&(n=h.depthFar)),D.near=T.near=w.near=t,D.far=T.far=w.far=n,(O!==D.near||ee!==D.far)&&(r.updateRenderState({depthNear:D.near,depthFar:D.far}),O=D.near,ee=D.far),D.layers.mask=e.layers.mask|6,w.layers.mask=D.layers.mask&-5,T.layers.mask=D.layers.mask&-3;let i=e.parent,a=D.cameras;ae(D,i);for(let e=0;e<a.length;e++)ae(a[e],i);a.length===2?ie(D,w,T):D.projectionMatrix.copy(w.projectionMatrix),oe(e,D,i)};function oe(e,t,n){n===null?e.matrix.copy(t.matrixWorld):(e.matrix.copy(n.matrixWorld),e.matrix.invert(),e.matrix.multiply(t.matrixWorld)),e.matrix.decompose(e.position,e.quaternion,e.scale),e.updateMatrixWorld(!0),e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse),e.isPerspectiveCamera&&(e.fov=_l*2*Math.atan(1/e.projectionMatrix.elements[5]),e.zoom=1)}this.getCamera=function(){return D},this.getFoveation=function(){if(!(d===null&&f===null))return s},this.setFoveation=function(e){s=e,d!==null&&(d.fixedFoveation=e),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=e)},this.hasDepthSensing=function(){return h.texture!==null},this.getDepthSensingMesh=function(){return h.getMesh(D)},this.getCameraTexture=function(e){return g[e]};let j=null;function se(t,i){if(l=i.getViewerPose(c||a),p=i,l!==null){let t=l.views;f!==null&&(e.setRenderTargetFramebuffer(y,f.framebuffer),e.setRenderTarget(y));let i=!1;t.length!==D.cameras.length&&(D.cameras.length=0,i=!0);for(let n=0;n<t.length;n++){let r=t[n],a=null;if(f!==null)a=f.getViewport(r);else{let t=u.getViewSubImage(d,r);a=t.viewport,n===0&&(e.setRenderTargetTextures(y,t.colorTexture,t.depthStencilTexture),e.setRenderTarget(y))}let o=E[n];o===void 0&&(o=new _m,o.layers.enable(n),o.viewport=new ou,E[n]=o),o.matrix.fromArray(r.transform.matrix),o.matrix.decompose(o.position,o.quaternion,o.scale),o.projectionMatrix.fromArray(r.projectionMatrix),o.projectionMatrixInverse.copy(o.projectionMatrix).invert(),o.viewport.set(a.x,a.y,a.width,a.height),n===0&&(D.matrix.copy(o.matrix),D.matrix.decompose(D.position,D.quaternion,D.scale)),i===!0&&D.cameras.push(o)}let a=r.enabledFeatures;if(a&&a.includes(`depth-sensing`)&&r.depthUsage==`gpu-optimized`&&m){u=n.getBinding();let e=u.getDepthInformation(t[0]);e&&e.isValid&&e.texture&&h.init(e,r.renderState)}if(a&&a.includes(`camera-access`)&&m){e.state.unbindTexture(),u=n.getBinding();for(let e=0;e<t.length;e++){let n=t[e].camera;if(n){let e=g[n];e||(e=new Gf,g[n]=e);let t=u.getCameraImage(n);e.sourceTexture=t}}}}for(let e=0;e<b.length;e++){let t=x[e],n=b[e];t!==null&&n!==void 0&&n.update(t,i,c||a)}j&&j(t,i),i.detectedPlanes&&n.dispatchEvent({type:`planesdetected`,data:i}),p=null}let ce=new Wm;ce.setAnimationLoop(se),this.setAnimationLoop=function(e){j=e},this.dispose=function(){}}},$_=new du,ev=new Wl;ev.set(-1,0,0,0,1,0,0,0,1);function tv(e,t){function n(e,t){e.matrixAutoUpdate===!0&&e.updateMatrix(),t.value.copy(e.matrix)}function r(t,n){n.color.getRGB(t.fogColor.value,Mp(e)),n.isFog?(t.fogNear.value=n.near,t.fogFar.value=n.far):n.isFogExp2&&(t.fogDensity.value=n.density)}function i(e,t,n,r,i){t.isNodeMaterial?t.uniformsNeedUpdate=!1:t.isMeshBasicMaterial?a(e,t):t.isMeshLambertMaterial?(a(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshToonMaterial?(a(e,t),d(e,t)):t.isMeshPhongMaterial?(a(e,t),u(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshStandardMaterial?(a(e,t),f(e,t),t.isMeshPhysicalMaterial&&p(e,t,i)):t.isMeshMatcapMaterial?(a(e,t),m(e,t)):t.isMeshDepthMaterial?a(e,t):t.isMeshDistanceMaterial?(a(e,t),h(e,t)):t.isMeshNormalMaterial?a(e,t):t.isLineBasicMaterial?(o(e,t),t.isLineDashedMaterial&&s(e,t)):t.isPointsMaterial?c(e,t,n,r):t.isSpriteMaterial?l(e,t):t.isShadowMaterial?(e.color.value.copy(t.color),e.opacity.value=t.opacity):t.isShaderMaterial&&(t.uniformsNeedUpdate=!1)}function a(e,r){e.opacity.value=r.opacity,r.color&&e.diffuse.value.copy(r.color),r.emissive&&e.emissive.value.copy(r.emissive).multiplyScalar(r.emissiveIntensity),r.map&&(e.map.value=r.map,n(r.map,e.mapTransform)),r.alphaMap&&(e.alphaMap.value=r.alphaMap,n(r.alphaMap,e.alphaMapTransform)),r.bumpMap&&(e.bumpMap.value=r.bumpMap,n(r.bumpMap,e.bumpMapTransform),e.bumpScale.value=r.bumpScale,r.side===1&&(e.bumpScale.value*=-1)),r.normalMap&&(e.normalMap.value=r.normalMap,n(r.normalMap,e.normalMapTransform),e.normalScale.value.copy(r.normalScale),r.side===1&&e.normalScale.value.negate()),r.displacementMap&&(e.displacementMap.value=r.displacementMap,n(r.displacementMap,e.displacementMapTransform),e.displacementScale.value=r.displacementScale,e.displacementBias.value=r.displacementBias),r.emissiveMap&&(e.emissiveMap.value=r.emissiveMap,n(r.emissiveMap,e.emissiveMapTransform)),r.specularMap&&(e.specularMap.value=r.specularMap,n(r.specularMap,e.specularMapTransform)),r.alphaTest>0&&(e.alphaTest.value=r.alphaTest);let i=t.get(r),a=i.envMap,o=i.envMapRotation;a&&(e.envMap.value=a,e.envMapRotation.value.setFromMatrix4($_.makeRotationFromEuler(o)).transpose(),a.isCubeTexture&&a.isRenderTargetTexture===!1&&e.envMapRotation.value.premultiply(ev),e.reflectivity.value=r.reflectivity,e.ior.value=r.ior,e.refractionRatio.value=r.refractionRatio),r.lightMap&&(e.lightMap.value=r.lightMap,e.lightMapIntensity.value=r.lightMapIntensity,n(r.lightMap,e.lightMapTransform)),r.aoMap&&(e.aoMap.value=r.aoMap,e.aoMapIntensity.value=r.aoMapIntensity,n(r.aoMap,e.aoMapTransform))}function o(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform))}function s(e,t){e.dashSize.value=t.dashSize,e.totalSize.value=t.dashSize+t.gapSize,e.scale.value=t.scale}function c(e,t,r,i){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.size.value=t.size*r,e.scale.value=i*.5,t.map&&(e.map.value=t.map,n(t.map,e.uvTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function l(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.rotation.value=t.rotation,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function u(e,t){e.specular.value.copy(t.specular),e.shininess.value=Math.max(t.shininess,1e-4)}function d(e,t){t.gradientMap&&(e.gradientMap.value=t.gradientMap)}function f(e,t){e.metalness.value=t.metalness,t.metalnessMap&&(e.metalnessMap.value=t.metalnessMap,n(t.metalnessMap,e.metalnessMapTransform)),e.roughness.value=t.roughness,t.roughnessMap&&(e.roughnessMap.value=t.roughnessMap,n(t.roughnessMap,e.roughnessMapTransform)),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)}function p(e,t,r){e.ior.value=t.ior,t.sheen>0&&(e.sheenColor.value.copy(t.sheenColor).multiplyScalar(t.sheen),e.sheenRoughness.value=t.sheenRoughness,t.sheenColorMap&&(e.sheenColorMap.value=t.sheenColorMap,n(t.sheenColorMap,e.sheenColorMapTransform)),t.sheenRoughnessMap&&(e.sheenRoughnessMap.value=t.sheenRoughnessMap,n(t.sheenRoughnessMap,e.sheenRoughnessMapTransform))),t.clearcoat>0&&(e.clearcoat.value=t.clearcoat,e.clearcoatRoughness.value=t.clearcoatRoughness,t.clearcoatMap&&(e.clearcoatMap.value=t.clearcoatMap,n(t.clearcoatMap,e.clearcoatMapTransform)),t.clearcoatRoughnessMap&&(e.clearcoatRoughnessMap.value=t.clearcoatRoughnessMap,n(t.clearcoatRoughnessMap,e.clearcoatRoughnessMapTransform)),t.clearcoatNormalMap&&(e.clearcoatNormalMap.value=t.clearcoatNormalMap,n(t.clearcoatNormalMap,e.clearcoatNormalMapTransform),e.clearcoatNormalScale.value.copy(t.clearcoatNormalScale),t.side===1&&e.clearcoatNormalScale.value.negate())),t.dispersion>0&&(e.dispersion.value=t.dispersion),t.iridescence>0&&(e.iridescence.value=t.iridescence,e.iridescenceIOR.value=t.iridescenceIOR,e.iridescenceThicknessMinimum.value=t.iridescenceThicknessRange[0],e.iridescenceThicknessMaximum.value=t.iridescenceThicknessRange[1],t.iridescenceMap&&(e.iridescenceMap.value=t.iridescenceMap,n(t.iridescenceMap,e.iridescenceMapTransform)),t.iridescenceThicknessMap&&(e.iridescenceThicknessMap.value=t.iridescenceThicknessMap,n(t.iridescenceThicknessMap,e.iridescenceThicknessMapTransform))),t.transmission>0&&(e.transmission.value=t.transmission,e.transmissionSamplerMap.value=r.texture,e.transmissionSamplerSize.value.set(r.width,r.height),t.transmissionMap&&(e.transmissionMap.value=t.transmissionMap,n(t.transmissionMap,e.transmissionMapTransform)),e.thickness.value=t.thickness,t.thicknessMap&&(e.thicknessMap.value=t.thicknessMap,n(t.thicknessMap,e.thicknessMapTransform)),e.attenuationDistance.value=t.attenuationDistance,e.attenuationColor.value.copy(t.attenuationColor)),t.anisotropy>0&&(e.anisotropyVector.value.set(t.anisotropy*Math.cos(t.anisotropyRotation),t.anisotropy*Math.sin(t.anisotropyRotation)),t.anisotropyMap&&(e.anisotropyMap.value=t.anisotropyMap,n(t.anisotropyMap,e.anisotropyMapTransform))),e.specularIntensity.value=t.specularIntensity,e.specularColor.value.copy(t.specularColor),t.specularColorMap&&(e.specularColorMap.value=t.specularColorMap,n(t.specularColorMap,e.specularColorMapTransform)),t.specularIntensityMap&&(e.specularIntensityMap.value=t.specularIntensityMap,n(t.specularIntensityMap,e.specularIntensityMapTransform))}function m(e,t){t.matcap&&(e.matcap.value=t.matcap)}function h(e,n){let r=t.get(n).light;e.referencePosition.value.setFromMatrixPosition(r.matrixWorld),e.nearDistance.value=r.shadow.camera.near,e.farDistance.value=r.shadow.camera.far}return{refreshFogUniforms:r,refreshMaterialUniforms:i}}function nv(e,t,n,r){let i={},a={},o=[],s=e.getParameter(e.MAX_UNIFORM_BUFFER_BINDINGS);function c(e,t){let n=t.program;r.uniformBlockBinding(e,n)}function l(e,n){let o=i[e.id];o===void 0&&(g(e),o=u(e),i[e.id]=o,e.addEventListener(`dispose`,v));let s=n.program;r.updateUBOMapping(e,s);let c=t.render.frame;a[e.id]!==c&&(f(e),a[e.id]=c)}function u(t){let n=d();t.__bindingPointIndex=n;let r=e.createBuffer(),i=t.__size,a=t.usage;return e.bindBuffer(e.UNIFORM_BUFFER,r),e.bufferData(e.UNIFORM_BUFFER,i,a),e.bindBuffer(e.UNIFORM_BUFFER,null),e.bindBufferBase(e.UNIFORM_BUFFER,n,r),r}function d(){for(let e=0;e<s;e++)if(o.indexOf(e)===-1)return o.push(e),e;return ll(`WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached.`),0}function f(t){let n=i[t.id],r=t.uniforms,a=t.__cache;e.bindBuffer(e.UNIFORM_BUFFER,n);for(let e=0,t=r.length;e<t;e++){let t=r[e];if(Array.isArray(t))for(let n=0,r=t.length;n<r;n++)p(t[n],e,n,a);else p(t,e,0,a)}e.bindBuffer(e.UNIFORM_BUFFER,null)}function p(t,n,r,i){if(h(t,n,r,i)===!0){let n=t.__offset,r=t.value;if(Array.isArray(r)){let e=0;for(let n=0;n<r.length;n++){let i=r[n],a=_(i);m(i,t.__data,e),typeof i!=`number`&&typeof i!=`boolean`&&!i.isMatrix3&&!ArrayBuffer.isView(i)&&(e+=a.storage/Float32Array.BYTES_PER_ELEMENT)}}else m(r,t.__data,0);e.bufferSubData(e.UNIFORM_BUFFER,n,t.__data)}}function m(e,t,n){typeof e==`number`||typeof e==`boolean`?t[0]=e:e.isMatrix3?(t[0]=e.elements[0],t[1]=e.elements[1],t[2]=e.elements[2],t[3]=0,t[4]=e.elements[3],t[5]=e.elements[4],t[6]=e.elements[5],t[7]=0,t[8]=e.elements[6],t[9]=e.elements[7],t[10]=e.elements[8],t[11]=0):ArrayBuffer.isView(e)?t.set(new e.constructor(e.buffer,e.byteOffset,t.length)):e.toArray(t,n)}function h(e,t,n,r){let i=e.value,a=t+`_`+n;if(r[a]===void 0)return typeof i==`number`||typeof i==`boolean`?r[a]=i:ArrayBuffer.isView(i)?r[a]=i.slice():r[a]=i.clone(),!0;{let e=r[a];if(typeof i==`number`||typeof i==`boolean`){if(e!==i)return r[a]=i,!0}else if(ArrayBuffer.isView(i))return!0;else if(e.equals(i)===!1)return e.copy(i),!0}return!1}function g(e){let t=e.uniforms,n=0;for(let e=0,r=t.length;e<r;e++){let r=Array.isArray(t[e])?t[e]:[t[e]];for(let e=0,t=r.length;e<t;e++){let t=r[e],i=Array.isArray(t.value)?t.value:[t.value];for(let e=0,r=i.length;e<r;e++){let r=i[e],a=_(r),o=n%16,s=o%a.boundary,c=o+s;n+=s,c!==0&&16-c<a.storage&&(n+=16-c),t.__data=new Float32Array(a.storage/Float32Array.BYTES_PER_ELEMENT),t.__offset=n,n+=a.storage}}}let r=n%16;return r>0&&(n+=16-r),e.__size=n,e.__cache={},this}function _(e){let t={boundary:0,storage:0};return typeof e==`number`||typeof e==`boolean`?(t.boundary=4,t.storage=4):e.isVector2?(t.boundary=8,t.storage=8):e.isVector3||e.isColor?(t.boundary=16,t.storage=12):e.isVector4?(t.boundary=16,t.storage=16):e.isMatrix3?(t.boundary=48,t.storage=48):e.isMatrix4?(t.boundary=64,t.storage=64):e.isTexture?X(`WebGLRenderer: Texture samplers can not be part of an uniforms group.`):ArrayBuffer.isView(e)?(t.boundary=16,t.storage=e.byteLength):X(`WebGLRenderer: Unsupported uniform value type.`,e),t}function v(t){let n=t.target;n.removeEventListener(`dispose`,v);let r=o.indexOf(n.__bindingPointIndex);o.splice(r,1),e.deleteBuffer(i[n.id]),delete i[n.id],delete a[n.id]}function y(){for(let t in i)e.deleteBuffer(i[t]);o=[],i={},a={}}return{bind:c,update:l,dispose:y}}var rv=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),iv=null;function av(){return iv===null&&(iv=new gf(rv,16,16,tc,Hs),iv.name=`DFG_LUT`,iv.minFilter=Ms,iv.magFilter=Ms,iv.wrapS=Ds,iv.wrapT=Ds,iv.generateMipmaps=!1,iv.needsUpdate=!0),iv}var ov=class{constructor(e={}){let{canvas:t=al(),context:n=null,depth:r=!0,stencil:i=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:s=!0,preserveDrawingBuffer:c=!1,powerPreference:l=`default`,failIfMajorPerformanceCaveat:u=!1,reversedDepthBuffer:d=!1,outputBufferType:f=Fs}=e;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<`u`&&n instanceof WebGLRenderingContext)throw Error(`THREE.WebGLRenderer: WebGL 1 is not supported since r163.`);p=n.getContextAttributes().alpha}else p=a;let m=f,h=new Set([rc,nc,ec]),g=new Set([Fs,Bs,Rs,Gs,Us,Ws]),_=new Uint32Array(4),v=new Int32Array(4),y=new Q,b=null,x=null,S=[],C=[],w=null;this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=0,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let T=this,E=!1,D=null,O=null,ee=null,k=null;this._outputColorSpace=Jc;let te=0,ne=0,A=null,re=-1,ie=null,ae=new ou,oe=new ou,j=null,se=new Ku(0),ce=0,le=t.width,M=t.height,ue=1,de=null,fe=null,pe=new ou(0,0,le,M),me=new ou(0,0,le,M),he=!1,ge=new Nf,_e=!1,ve=!1,ye=new du,be=new Q,N=new ou,xe={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},P=!1;function Se(){return A===null?ue:1}let F=n;function Ce(e,n){return t.getContext(e,n)}try{let e={alpha:!0,depth:r,stencil:i,antialias:o,premultipliedAlpha:s,preserveDrawingBuffer:c,powerPreference:l,failIfMajorPerformanceCaveat:u};if(`setAttribute`in t&&t.setAttribute(`data-engine`,`three.js r185`),t.addEventListener(`webglcontextlost`,Ue,!1),t.addEventListener(`webglcontextrestored`,We,!1),t.addEventListener(`webglcontextcreationerror`,Ge,!1),F===null){let t=`webgl2`;if(F=Ce(t,e),F===null)throw Ce(t)?Error(`THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.`):Error(`THREE.WebGLRenderer: Error creating WebGL context.`)}}catch(e){throw ll(`WebGLRenderer: `+e.message),e}let we,Te,I,Ee,L,De,Oe,R,ke,z,Ae,je,Me,Ne,Pe,Fe,Ie,Le,B,Re,ze,Be,Ve;function He(){we=new wh(F),we.init(),ze=new J_(F,we),Te=new eh(F,we,e,ze),I=new K_(F,we),Te.reversedDepthBuffer&&d&&I.buffers.depth.setReversed(!0),O=F.createFramebuffer(),ee=F.createFramebuffer(),k=F.createFramebuffer(),Ee=new Dh(F),L=new E_,De=new q_(F,we,I,L,Te,ze,Ee),Oe=new Ch(T),R=new Gm(F),Be=new Qm(F,R),ke=new Th(F,R,Ee,Be),z=new kh(F,ke,R,Be,Ee),Le=new Oh(F,Te,De),Pe=new th(L),Ae=new T_(T,Oe,we,Te,Be,Pe),je=new tv(T,L),Me=new A_,Ne=new L_(we),Ie=new Zm(T,Oe,I,z,p,s),Fe=new G_(T,z,Te),Ve=new nv(F,Ee,Te,I),B=new $m(F,we,Ee),Re=new Eh(F,we,Ee),Ee.programs=Ae.programs,T.capabilities=Te,T.extensions=we,T.properties=L,T.renderLists=Me,T.shadowMap=Fe,T.state=I,T.info=Ee}He(),m!==1009&&(w=new jh(m,t.width,t.height,o,r,i));let V=new Q_(T,F);this.xr=V,this.getContext=function(){return F},this.getContextAttributes=function(){return F.getContextAttributes()},this.forceContextLoss=function(){let e=we.get(`WEBGL_lose_context`);e&&e.loseContext()},this.forceContextRestore=function(){let e=we.get(`WEBGL_lose_context`);e&&e.restoreContext()},this.getPixelRatio=function(){return ue},this.setPixelRatio=function(e){e!==void 0&&(ue=e,this.setSize(le,M,!1))},this.getSize=function(e){return e.set(le,M)},this.setSize=function(e,n,r=!0){if(V.isPresenting){X(`WebGLRenderer: Can't change size while VR device is presenting.`);return}le=e,M=n,t.width=Math.floor(e*ue),t.height=Math.floor(n*ue),r===!0&&(t.style.width=e+`px`,t.style.height=n+`px`),w!==null&&w.setSize(t.width,t.height),this.setViewport(0,0,e,n)},this.getDrawingBufferSize=function(e){return e.set(le*ue,M*ue).floor()},this.setDrawingBufferSize=function(e,n,r){le=e,M=n,ue=r,t.width=Math.floor(e*r),t.height=Math.floor(n*r),this.setViewport(0,0,e,n)},this.setEffects=function(e){if(m===1009){ll(`WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.`);return}if(e){for(let t=0;t<e.length;t++)if(e[t].isOutputPass===!0){X(`WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.`);break}}w.setEffects(e||[])},this.getCurrentViewport=function(e){return e.copy(ae)},this.getViewport=function(e){return e.copy(pe)},this.setViewport=function(e,t,n,r){e.isVector4?pe.set(e.x,e.y,e.z,e.w):pe.set(e,t,n,r),I.viewport(ae.copy(pe).multiplyScalar(ue).round())},this.getScissor=function(e){return e.copy(me)},this.setScissor=function(e,t,n,r){e.isVector4?me.set(e.x,e.y,e.z,e.w):me.set(e,t,n,r),I.scissor(oe.copy(me).multiplyScalar(ue).round())},this.getScissorTest=function(){return he},this.setScissorTest=function(e){I.setScissorTest(he=e)},this.setOpaqueSort=function(e){de=e},this.setTransparentSort=function(e){fe=e},this.getClearColor=function(e){return e.copy(Ie.getClearColor())},this.setClearColor=function(){Ie.setClearColor(...arguments)},this.getClearAlpha=function(){return Ie.getClearAlpha()},this.setClearAlpha=function(){Ie.setClearAlpha(...arguments)},this.clear=function(e=!0,t=!0,n=!0){let r=0;if(e){let e=!1;if(A!==null){let t=A.texture.format;e=h.has(t)}if(e){let e=A.texture.type,t=g.has(e),n=Ie.getClearColor(),r=Ie.getClearAlpha(),i=n.r,a=n.g,o=n.b;t?(_[0]=i,_[1]=a,_[2]=o,_[3]=r,F.clearBufferuiv(F.COLOR,0,_)):(v[0]=i,v[1]=a,v[2]=o,v[3]=r,F.clearBufferiv(F.COLOR,0,v))}else r|=F.COLOR_BUFFER_BIT}t&&(r|=F.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),n&&(r|=F.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),r!==0&&F.clear(r)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(e){e.setRenderer(this),D=e},this.dispose=function(){t.removeEventListener(`webglcontextlost`,Ue,!1),t.removeEventListener(`webglcontextrestored`,We,!1),t.removeEventListener(`webglcontextcreationerror`,Ge,!1),Ie.dispose(),Me.dispose(),Ne.dispose(),L.dispose(),Oe.dispose(),z.dispose(),Be.dispose(),Ve.dispose(),Ae.dispose(),V.dispose(),V.removeEventListener(`sessionstart`,Qe),V.removeEventListener(`sessionend`,$e),et.stop()};function Ue(e){e.preventDefault(),sl(`WebGLRenderer: Context Lost.`),E=!0}function We(){sl(`WebGLRenderer: Context Restored.`),E=!1;let e=Ee.autoReset,t=Fe.enabled,n=Fe.autoUpdate,r=Fe.needsUpdate,i=Fe.type;He(),Ee.autoReset=e,Fe.enabled=t,Fe.autoUpdate=n,Fe.needsUpdate=r,Fe.type=i}function Ge(e){ll(`WebGLRenderer: A WebGL context could not be created. Reason: `,e.statusMessage)}function Ke(e){let t=e.target;t.removeEventListener(`dispose`,Ke),qe(t)}function qe(e){Je(e),L.remove(e)}function Je(e){let t=L.get(e).programs;t!==void 0&&(t.forEach(function(e){Ae.releaseProgram(e)}),e.isShaderMaterial&&Ae.releaseShaderCache(e))}this.renderBufferDirect=function(e,t,n,r,i,a){t===null&&(t=xe);let o=i.isMesh&&i.matrixWorld.determinantAffine()<0,s=ut(e,t,n,r,i);I.setMaterial(r,o);let c=n.index,l=1;if(r.wireframe===!0){if(c=ke.getWireframeAttribute(n),c===void 0)return;l=2}let u=n.drawRange,d=n.attributes.position,f=u.start*l,p=(u.start+u.count)*l;a!==null&&(f=Math.max(f,a.start*l),p=Math.min(p,(a.start+a.count)*l)),c===null?d!=null&&(f=Math.max(f,0),p=Math.min(p,d.count)):(f=Math.max(f,0),p=Math.min(p,c.count));let m=p-f;if(m<0||m===1/0)return;Be.setup(i,r,s,n,c);let h,g=B;if(c!==null&&(h=R.get(c),g=Re,g.setIndex(h)),i.isMesh)r.wireframe===!0?(I.setLineWidth(r.wireframeLinewidth*Se()),g.setMode(F.LINES)):g.setMode(F.TRIANGLES);else if(i.isLine){let e=r.linewidth;e===void 0&&(e=1),I.setLineWidth(e*Se()),i.isLineSegments?g.setMode(F.LINES):i.isLineLoop?g.setMode(F.LINE_LOOP):g.setMode(F.LINE_STRIP)}else i.isPoints?g.setMode(F.POINTS):i.isSprite&&g.setMode(F.TRIANGLES);if(i.isBatchedMesh)if(we.get(`WEBGL_multi_draw`))g.renderMultiDraw(i._multiDrawStarts,i._multiDrawCounts,i._multiDrawCount);else{let e=i._multiDrawStarts,t=i._multiDrawCounts,n=i._multiDrawCount,a=c?R.get(c).bytesPerElement:1,o=L.get(r).currentProgram.getUniforms();for(let r=0;r<n;r++)o.setValue(F,`_gl_DrawID`,r),g.render(e[r]/a,t[r])}else if(i.isInstancedMesh)g.renderInstances(f,m,i.count);else if(n.isInstancedBufferGeometry){let e=n._maxInstanceCount===void 0?1/0:n._maxInstanceCount,t=Math.min(n.instanceCount,e);g.renderInstances(f,m,t)}else g.render(f,m)};function Ye(e,t,n){e.transparent===!0&&e.side===2&&e.forceSinglePass===!1?(e.side=1,e.needsUpdate=!0,ot(e,t,n),e.side=0,e.needsUpdate=!0,ot(e,t,n),e.side=2):ot(e,t,n)}this.compile=function(e,t,n=null){n===null&&(n=e),x=Ne.get(n),x.init(t),C.push(x),n.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(x.pushLight(e),e.castShadow&&x.pushShadow(e))}),e!==n&&e.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(x.pushLight(e),e.castShadow&&x.pushShadow(e))}),x.setupLights();let r=new Set;return e.traverse(function(e){if(!(e.isMesh||e.isPoints||e.isLine||e.isSprite))return;let t=e.material;if(t)if(Array.isArray(t))for(let i=0;i<t.length;i++){let a=t[i];Ye(a,n,e),r.add(a)}else Ye(t,n,e),r.add(t)}),x=C.pop(),r},this.compileAsync=function(e,t,n=null){let r=this.compile(e,t,n);return new Promise(t=>{function n(){if(r.forEach(function(e){L.get(e).currentProgram.isReady()&&r.delete(e)}),r.size===0){t(e);return}setTimeout(n,10)}we.get(`KHR_parallel_shader_compile`)===null?setTimeout(n,10):n()})};let Xe=null;function Ze(e){Xe&&Xe(e)}function Qe(){et.stop()}function $e(){et.start()}let et=new Wm;et.setAnimationLoop(Ze),typeof self<`u`&&et.setContext(self),this.setAnimationLoop=function(e){Xe=e,V.setAnimationLoop(e),e===null?et.stop():et.start()},V.addEventListener(`sessionstart`,Qe),V.addEventListener(`sessionend`,$e),this.render=function(e,t){if(t!==void 0&&t.isCamera!==!0){ll(`WebGLRenderer.render: camera is not an instance of THREE.Camera.`);return}if(E===!0)return;D!==null&&D.renderStart(e,t);let n=V.enabled===!0&&V.isPresenting===!0,r=w!==null&&(A===null||n)&&w.begin(T,A);if(e.matrixWorldAutoUpdate===!0&&e.updateMatrixWorld(),t.parent===null&&t.matrixWorldAutoUpdate===!0&&t.updateMatrixWorld(),V.enabled===!0&&V.isPresenting===!0&&(w===null||w.isCompositing()===!1)&&(V.cameraAutoUpdate===!0&&V.updateCamera(t),t=V.getCamera()),e.isScene===!0&&e.onBeforeRender(T,e,t,A),x=Ne.get(e,C.length),x.init(t),x.state.textureUnits=De.getTextureUnits(),C.push(x),ye.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),ge.setFromProjectionMatrix(ye,tl,t.reversedDepth),ve=this.localClippingEnabled,_e=Pe.init(this.clippingPlanes,ve),b=Me.get(e,S.length),b.init(),S.push(b),V.enabled===!0&&V.isPresenting===!0){let e=T.xr.getDepthSensingMesh();e!==null&&tt(e,t,-1/0,T.sortObjects)}tt(e,t,0,T.sortObjects),b.finish(),T.sortObjects===!0&&b.sort(de,fe,t.reversedDepth),P=V.enabled===!1||V.isPresenting===!1||V.hasDepthSensing()===!1,P&&Ie.addToRenderList(b,e),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),_e===!0&&Pe.beginShadows();let i=x.state.shadowsArray;if(Fe.render(i,e,t),_e===!0&&Pe.endShadows(),(r&&w.hasRenderPass())===!1){let n=b.opaque,r=b.transmissive;if(x.setupLights(),t.isArrayCamera){let i=t.cameras;if(r.length>0)for(let t=0,a=i.length;t<a;t++){let a=i[t];rt(n,r,e,a)}P&&Ie.render(e);for(let t=0,n=i.length;t<n;t++){let n=i[t];nt(b,e,n,n.viewport)}}else r.length>0&&rt(n,r,e,t),P&&Ie.render(e),nt(b,e,t)}A!==null&&ne===0&&(De.updateMultisampleRenderTarget(A),De.updateRenderTargetMipmap(A)),r&&w.end(T),e.isScene===!0&&e.onAfterRender(T,e,t),Be.resetDefaultState(),re=-1,ie=null,C.pop(),C.length>0?(x=C[C.length-1],De.setTextureUnits(x.state.textureUnits),_e===!0&&Pe.setGlobalState(T.clippingPlanes,x.state.camera)):x=null,S.pop(),b=S.length>0?S[S.length-1]:null,D!==null&&D.renderEnd()};function tt(e,t,n,r){if(e.visible===!1)return;if(e.layers.test(t.layers)){if(e.isGroup)n=e.renderOrder;else if(e.isLOD)e.autoUpdate===!0&&e.update(t);else if(e.isLightProbeGrid)x.pushLightProbeGrid(e);else if(e.isLight)x.pushLight(e),e.castShadow&&x.pushShadow(e);else if(e.isSprite){if(!e.frustumCulled||ge.intersectsSprite(e)){r&&N.setFromMatrixPosition(e.matrixWorld).applyMatrix4(ye);let t=z.update(e),i=e.material;i.visible&&b.push(e,t,i,n,N.z,null)}}else if((e.isMesh||e.isLine||e.isPoints)&&(!e.frustumCulled||ge.intersectsObject(e))){let t=z.update(e),i=e.material;if(r&&(e.boundingSphere===void 0?(t.boundingSphere===null&&t.computeBoundingSphere(),N.copy(t.boundingSphere.center)):(e.boundingSphere===null&&e.computeBoundingSphere(),N.copy(e.boundingSphere.center)),N.applyMatrix4(e.matrixWorld).applyMatrix4(ye)),Array.isArray(i)){let r=t.groups;for(let a=0,o=r.length;a<o;a++){let o=r[a],s=i[o.materialIndex];s&&s.visible&&b.push(e,t,s,n,N.z,o)}}else i.visible&&b.push(e,t,i,n,N.z,null)}}let i=e.children;for(let e=0,a=i.length;e<a;e++)tt(i[e],t,n,r)}function nt(e,t,n,r){let{opaque:i,transmissive:a,transparent:o}=e;x.setupLightsView(n),_e===!0&&Pe.setGlobalState(T.clippingPlanes,n),r&&I.viewport(ae.copy(r)),i.length>0&&it(i,t,n),a.length>0&&it(a,t,n),o.length>0&&it(o,t,n),I.buffers.depth.setTest(!0),I.buffers.depth.setMask(!0),I.buffers.color.setMask(!0),I.setPolygonOffset(!1)}function rt(e,t,n,r){if((n.isScene===!0?n.overrideMaterial:null)!==null)return;if(x.state.transmissionRenderTarget[r.id]===void 0){let e=we.has(`EXT_color_buffer_half_float`)||we.has(`EXT_color_buffer_float`);x.state.transmissionRenderTarget[r.id]=new cu(1,1,{generateMipmaps:!0,type:e?Hs:Fs,minFilter:Ps,samples:Math.max(4,Te.samples),stencilBuffer:i,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Yl.workingColorSpace})}let a=x.state.transmissionRenderTarget[r.id],o=r.viewport||ae;a.setSize(o.z*T.transmissionResolutionScale,o.w*T.transmissionResolutionScale);let s=T.getRenderTarget(),c=T.getActiveCubeFace(),l=T.getActiveMipmapLevel();T.setRenderTarget(a),T.getClearColor(se),ce=T.getClearAlpha(),ce<1&&T.setClearColor(16777215,.5),T.clear(),P&&Ie.render(n);let u=T.toneMapping;T.toneMapping=0;let d=r.viewport;if(r.viewport!==void 0&&(r.viewport=void 0),x.setupLightsView(r),_e===!0&&Pe.setGlobalState(T.clippingPlanes,r),it(e,n,r),De.updateMultisampleRenderTarget(a),De.updateRenderTargetMipmap(a),we.has(`WEBGL_multisampled_render_to_texture`)===!1){let e=!1;for(let i=0,a=t.length;i<a;i++){let{object:a,geometry:o,material:s,group:c}=t[i];if(s.side===2&&a.layers.test(r.layers)){let t=s.side;s.side=1,s.needsUpdate=!0,at(a,n,r,o,s,c),s.side=t,s.needsUpdate=!0,e=!0}}e===!0&&(De.updateMultisampleRenderTarget(a),De.updateRenderTargetMipmap(a))}T.setRenderTarget(s,c,l),T.setClearColor(se,ce),d!==void 0&&(r.viewport=d),T.toneMapping=u}function it(e,t,n){let r=t.isScene===!0?t.overrideMaterial:null;for(let i=0,a=e.length;i<a;i++){let a=e[i],{object:o,geometry:s,group:c}=a,l=a.material;l.allowOverride===!0&&r!==null&&(l=r),o.layers.test(n.layers)&&at(o,t,n,s,l,c)}}function at(e,t,n,r,i,a){e.onBeforeRender(T,t,n,r,i,a),e.modelViewMatrix.multiplyMatrices(n.matrixWorldInverse,e.matrixWorld),e.normalMatrix.getNormalMatrix(e.modelViewMatrix),i.onBeforeRender(T,t,n,r,e,a),i.transparent===!0&&i.side===2&&i.forceSinglePass===!1?(i.side=1,i.needsUpdate=!0,T.renderBufferDirect(n,t,r,i,e,a),i.side=0,i.needsUpdate=!0,T.renderBufferDirect(n,t,r,i,e,a),i.side=2):T.renderBufferDirect(n,t,r,i,e,a),e.onAfterRender(T,t,n,r,i,a)}function ot(e,t,n){t.isScene!==!0&&(t=xe);let r=L.get(e),i=x.state.lights,a=x.state.shadowsArray,o=i.state.version,s=Ae.getParameters(e,i.state,a,t,n,x.state.lightProbeGridArray),c=Ae.getProgramCacheKey(s),l=r.programs;r.environment=e.isMeshStandardMaterial||e.isMeshLambertMaterial||e.isMeshPhongMaterial?t.environment:null,r.fog=t.fog;let u=e.isMeshStandardMaterial||e.isMeshLambertMaterial&&!e.envMap||e.isMeshPhongMaterial&&!e.envMap;r.envMap=Oe.get(e.envMap||r.environment,u),r.envMapRotation=r.environment!==null&&e.envMap===null?t.environmentRotation:e.envMapRotation,l===void 0&&(e.addEventListener(`dispose`,Ke),l=new Map,r.programs=l);let d=l.get(c);if(d!==void 0){if(r.currentProgram===d&&r.lightsStateVersion===o)return ct(e,s),d}else s.uniforms=Ae.getUniforms(e),D!==null&&e.isNodeMaterial&&D.build(e,n,s),e.onBeforeCompile(s,T),d=Ae.acquireProgram(s,c),l.set(c,d),r.uniforms=s.uniforms;let f=r.uniforms;return(!e.isShaderMaterial&&!e.isRawShaderMaterial||e.clipping===!0)&&(f.clippingPlanes=Pe.uniform),ct(e,s),r.needsLights=ft(e),r.lightsStateVersion=o,r.needsLights&&(f.ambientLightColor.value=i.state.ambient,f.lightProbe.value=i.state.probe,f.directionalLights.value=i.state.directional,f.directionalLightShadows.value=i.state.directionalShadow,f.spotLights.value=i.state.spot,f.spotLightShadows.value=i.state.spotShadow,f.rectAreaLights.value=i.state.rectArea,f.ltc_1.value=i.state.rectAreaLTC1,f.ltc_2.value=i.state.rectAreaLTC2,f.pointLights.value=i.state.point,f.pointLightShadows.value=i.state.pointShadow,f.hemisphereLights.value=i.state.hemi,f.directionalShadowMatrix.value=i.state.directionalShadowMatrix,f.spotLightMatrix.value=i.state.spotLightMatrix,f.spotLightMap.value=i.state.spotLightMap,f.pointShadowMatrix.value=i.state.pointShadowMatrix),r.lightProbeGrid=x.state.lightProbeGridArray.length>0,r.currentProgram=d,r.uniformsList=null,d}function st(e){if(e.uniformsList===null){let t=e.currentProgram.getUniforms();e.uniformsList=Rg.seqWithValue(t.seq,e.uniforms)}return e.uniformsList}function ct(e,t){let n=L.get(e);n.outputColorSpace=t.outputColorSpace,n.batching=t.batching,n.batchingColor=t.batchingColor,n.instancing=t.instancing,n.instancingColor=t.instancingColor,n.instancingMorph=t.instancingMorph,n.skinning=t.skinning,n.morphTargets=t.morphTargets,n.morphNormals=t.morphNormals,n.morphColors=t.morphColors,n.morphTargetsCount=t.morphTargetsCount,n.numClippingPlanes=t.numClippingPlanes,n.numIntersection=t.numClipIntersection,n.vertexAlphas=t.vertexAlphas,n.vertexTangents=t.vertexTangents,n.toneMapping=t.toneMapping}function lt(e,t){if(e.length===0)return null;if(e.length===1)return e[0].texture===null?null:e[0];y.setFromMatrixPosition(t.matrixWorld);for(let t=0,n=e.length;t<n;t++){let n=e[t];if(n.texture!==null&&n.boundingBox.containsPoint(y))return n}return null}function ut(e,t,n,r,i){t.isScene!==!0&&(t=xe),De.resetTextureUnits();let a=t.fog,o=r.isMeshStandardMaterial||r.isMeshLambertMaterial||r.isMeshPhongMaterial?t.environment:null,s=A===null?T.outputColorSpace:A.isXRRenderTarget===!0?A.texture.colorSpace:Yl.workingColorSpace,c=r.isMeshStandardMaterial||r.isMeshLambertMaterial&&!r.envMap||r.isMeshPhongMaterial&&!r.envMap,l=Oe.get(r.envMap||o,c),u=r.vertexColors===!0&&!!n.attributes.color&&n.attributes.color.itemSize===4,d=!!n.attributes.tangent&&(!!r.normalMap||r.anisotropy>0),f=!!n.morphAttributes.position,p=!!n.morphAttributes.normal,m=!!n.morphAttributes.color,h=0;r.toneMapped&&(A===null||A.isXRRenderTarget===!0)&&(h=T.toneMapping);let g=n.morphAttributes.position||n.morphAttributes.normal||n.morphAttributes.color,_=g===void 0?0:g.length,v=L.get(r),y=x.state.lights;if(_e===!0&&(ve===!0||e!==ie)){let t=e===ie&&r.id===re;Pe.setState(r,e,t)}let b=!1;r.version===v.__version?v.needsLights&&v.lightsStateVersion!==y.state.version?b=!0:v.outputColorSpace===s?i.isBatchedMesh&&v.batching===!1||!i.isBatchedMesh&&v.batching===!0||i.isBatchedMesh&&v.batchingColor===!0&&i.colorTexture===null||i.isBatchedMesh&&v.batchingColor===!1&&i.colorTexture!==null||i.isInstancedMesh&&v.instancing===!1||!i.isInstancedMesh&&v.instancing===!0||i.isSkinnedMesh&&v.skinning===!1||!i.isSkinnedMesh&&v.skinning===!0||i.isInstancedMesh&&v.instancingColor===!0&&i.instanceColor===null||i.isInstancedMesh&&v.instancingColor===!1&&i.instanceColor!==null||i.isInstancedMesh&&v.instancingMorph===!0&&i.morphTexture===null||i.isInstancedMesh&&v.instancingMorph===!1&&i.morphTexture!==null?b=!0:v.envMap===l?r.fog===!0&&v.fog!==a||v.numClippingPlanes!==void 0&&(v.numClippingPlanes!==Pe.numPlanes||v.numIntersection!==Pe.numIntersection)?b=!0:v.vertexAlphas===u&&v.vertexTangents===d&&v.morphTargets===f&&v.morphNormals===p&&v.morphColors===m&&v.toneMapping===h&&v.morphTargetsCount===_?!!v.lightProbeGrid!=x.state.lightProbeGridArray.length>0&&(b=!0):b=!0:b=!0:b=!0:(b=!0,v.__version=r.version);let S=v.currentProgram;b===!0&&(S=ot(r,t,i),D&&r.isNodeMaterial&&D.onUpdateProgram(r,S,v));let C=!1,w=!1,E=!1,O=S.getUniforms(),ee=v.uniforms;if(I.useProgram(S.program)&&(C=!0,w=!0,E=!0),r.id!==re&&(re=r.id,w=!0),v.needsLights){let e=lt(x.state.lightProbeGridArray,i);v.lightProbeGrid!==e&&(v.lightProbeGrid=e,w=!0)}if(C||ie!==e){I.buffers.depth.getReversed()&&e.reversedDepth!==!0&&(e._reversedDepth=!0,e.updateProjectionMatrix()),O.setValue(F,`projectionMatrix`,e.projectionMatrix),O.setValue(F,`viewMatrix`,e.matrixWorldInverse);let t=O.map.cameraPosition;t!==void 0&&t.setValue(F,be.setFromMatrixPosition(e.matrixWorld)),Te.logarithmicDepthBuffer&&O.setValue(F,`logDepthBufFC`,2/(Math.log(e.far+1)/Math.LN2)),(r.isMeshPhongMaterial||r.isMeshToonMaterial||r.isMeshLambertMaterial||r.isMeshBasicMaterial||r.isMeshStandardMaterial||r.isShaderMaterial)&&O.setValue(F,`isOrthographic`,e.isOrthographicCamera===!0),ie!==e&&(ie=e,w=!0,E=!0)}if(v.needsLights&&(y.state.directionalShadowMap.length>0&&O.setValue(F,`directionalShadowMap`,y.state.directionalShadowMap,De),y.state.spotShadowMap.length>0&&O.setValue(F,`spotShadowMap`,y.state.spotShadowMap,De),y.state.pointShadowMap.length>0&&O.setValue(F,`pointShadowMap`,y.state.pointShadowMap,De)),i.isSkinnedMesh){O.setOptional(F,i,`bindMatrix`),O.setOptional(F,i,`bindMatrixInverse`);let e=i.skeleton;e&&(e.boneTexture===null&&e.computeBoneTexture(),O.setValue(F,`boneTexture`,e.boneTexture,De))}i.isBatchedMesh&&(O.setOptional(F,i,`batchingTexture`),O.setValue(F,`batchingTexture`,i._matricesTexture,De),O.setOptional(F,i,`batchingIdTexture`),O.setValue(F,`batchingIdTexture`,i._indirectTexture,De),O.setOptional(F,i,`batchingColorTexture`),i._colorsTexture!==null&&O.setValue(F,`batchingColorTexture`,i._colorsTexture,De));let k=n.morphAttributes;if((k.position!==void 0||k.normal!==void 0||k.color!==void 0)&&Le.update(i,n,S),(w||v.receiveShadow!==i.receiveShadow)&&(v.receiveShadow=i.receiveShadow,O.setValue(F,`receiveShadow`,i.receiveShadow)),(r.isMeshStandardMaterial||r.isMeshLambertMaterial||r.isMeshPhongMaterial)&&r.envMap===null&&t.environment!==null&&(ee.envMapIntensity.value=t.environmentIntensity),ee.dfgLUT!==void 0&&(ee.dfgLUT.value=av()),w){if(O.setValue(F,`toneMappingExposure`,T.toneMappingExposure),v.needsLights&&dt(ee,E),a&&r.fog===!0&&je.refreshFogUniforms(ee,a),je.refreshMaterialUniforms(ee,r,ue,M,x.state.transmissionRenderTarget[e.id]),v.needsLights&&v.lightProbeGrid){let e=v.lightProbeGrid;ee.probesSH.value=e.texture,ee.probesMin.value.copy(e.boundingBox.min),ee.probesMax.value.copy(e.boundingBox.max),ee.probesResolution.value.copy(e.resolution)}Rg.upload(F,st(v),ee,De)}if(r.isShaderMaterial&&r.uniformsNeedUpdate===!0&&(Rg.upload(F,st(v),ee,De),r.uniformsNeedUpdate=!1),r.isSpriteMaterial&&O.setValue(F,`center`,i.center),O.setValue(F,`modelViewMatrix`,i.modelViewMatrix),O.setValue(F,`normalMatrix`,i.normalMatrix),O.setValue(F,`modelMatrix`,i.matrixWorld),r.uniformsGroups!==void 0){let e=r.uniformsGroups;for(let t=0,n=e.length;t<n;t++){let n=e[t];Ve.update(n,S),Ve.bind(n,S)}}return S}function dt(e,t){e.ambientLightColor.needsUpdate=t,e.lightProbe.needsUpdate=t,e.directionalLights.needsUpdate=t,e.directionalLightShadows.needsUpdate=t,e.pointLights.needsUpdate=t,e.pointLightShadows.needsUpdate=t,e.spotLights.needsUpdate=t,e.spotLightShadows.needsUpdate=t,e.rectAreaLights.needsUpdate=t,e.hemisphereLights.needsUpdate=t}function ft(e){return e.isMeshLambertMaterial||e.isMeshToonMaterial||e.isMeshPhongMaterial||e.isMeshStandardMaterial||e.isShadowMaterial||e.isShaderMaterial&&e.lights===!0}this.getActiveCubeFace=function(){return te},this.getActiveMipmapLevel=function(){return ne},this.getRenderTarget=function(){return A},this.setRenderTargetTextures=function(e,t,n){let r=L.get(e);r.__autoAllocateDepthBuffer=e.resolveDepthBuffer===!1,r.__autoAllocateDepthBuffer===!1&&(r.__useRenderToTexture=!1),L.get(e.texture).__webglTexture=t,L.get(e.depthTexture).__webglTexture=r.__autoAllocateDepthBuffer?void 0:n,r.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(e,t){let n=L.get(e);n.__webglFramebuffer=t,n.__useDefaultFramebuffer=t===void 0},this.setRenderTarget=function(e,t=0,n=0){A=e,te=t,ne=n;let r=null,i=!1,a=!1;if(e){let o=L.get(e);if(o.__useDefaultFramebuffer!==void 0){I.bindFramebuffer(F.FRAMEBUFFER,o.__webglFramebuffer),ae.copy(e.viewport),oe.copy(e.scissor),j=e.scissorTest,I.viewport(ae),I.scissor(oe),I.setScissorTest(j),re=-1;return}else if(o.__webglFramebuffer===void 0)De.setupRenderTarget(e);else if(o.__hasExternalTextures)De.rebindTextures(e,L.get(e.texture).__webglTexture,L.get(e.depthTexture).__webglTexture);else if(e.depthBuffer){let t=e.depthTexture;if(o.__boundDepthTexture!==t){if(t!==null&&L.has(t)&&(e.width!==t.image.width||e.height!==t.image.height))throw Error(`THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.`);De.setupDepthRenderbuffer(e)}}let s=e.texture;(s.isData3DTexture||s.isDataArrayTexture||s.isCompressedArrayTexture)&&(a=!0);let c=L.get(e).__webglFramebuffer;e.isWebGLCubeRenderTarget?(r=Array.isArray(c[t])?c[t][n]:c[t],i=!0):r=e.samples>0&&De.useMultisampledRTT(e)===!1?L.get(e).__webglMultisampledFramebuffer:Array.isArray(c)?c[n]:c,ae.copy(e.viewport),oe.copy(e.scissor),j=e.scissorTest}else ae.copy(pe).multiplyScalar(ue).floor(),oe.copy(me).multiplyScalar(ue).floor(),j=he;if(n!==0&&(r=O),I.bindFramebuffer(F.FRAMEBUFFER,r)&&I.drawBuffers(e,r),I.viewport(ae),I.scissor(oe),I.setScissorTest(j),i){let r=L.get(e.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_CUBE_MAP_POSITIVE_X+t,r.__webglTexture,n)}else if(a){let r=t;for(let t=0;t<e.textures.length;t++){let i=L.get(e.textures[t]);F.framebufferTextureLayer(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0+t,i.__webglTexture,n,r)}}else if(e!==null&&n!==0){let t=L.get(e.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,t.__webglTexture,n)}re=-1},this.readRenderTargetPixels=function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget)){ll(`WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);return}let c=L.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c){I.bindFramebuffer(F.FRAMEBUFFER,c);try{let o=e.textures[s],c=o.format,l=o.type;if(e.textures.length>1&&F.readBuffer(F.COLOR_ATTACHMENT0+s),!Te.textureFormatReadable(c)){ll(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.`);return}if(!Te.textureTypeReadable(l)){ll(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.`);return}t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i&&F.readPixels(t,n,r,i,ze.convert(c),ze.convert(l),a)}finally{let e=A===null?null:L.get(A).__webglFramebuffer;I.bindFramebuffer(F.FRAMEBUFFER,e)}}},this.readRenderTargetPixelsAsync=async function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget))throw Error(`THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);let c=L.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c)if(t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i){I.bindFramebuffer(F.FRAMEBUFFER,c);let o=e.textures[s],l=o.format,u=o.type;if(e.textures.length>1&&F.readBuffer(F.COLOR_ATTACHMENT0+s),!Te.textureFormatReadable(l))throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.`);if(!Te.textureTypeReadable(u))throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.`);let d=F.createBuffer();F.bindBuffer(F.PIXEL_PACK_BUFFER,d),F.bufferData(F.PIXEL_PACK_BUFFER,a.byteLength,F.STREAM_READ),F.readPixels(t,n,r,i,ze.convert(l),ze.convert(u),0);let f=A===null?null:L.get(A).__webglFramebuffer;I.bindFramebuffer(F.FRAMEBUFFER,f);let p=F.fenceSync(F.SYNC_GPU_COMMANDS_COMPLETE,0);return F.flush(),await dl(F,p,4),F.bindBuffer(F.PIXEL_PACK_BUFFER,d),F.getBufferSubData(F.PIXEL_PACK_BUFFER,0,a),F.deleteBuffer(d),F.deleteSync(p),a}else throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.`)},this.copyFramebufferToTexture=function(e,t=null,n=0){let r=2**-n,i=Math.floor(e.image.width*r),a=Math.floor(e.image.height*r),o=t===null?0:t.x,s=t===null?0:t.y;De.setTexture2D(e,0),F.copyTexSubImage2D(F.TEXTURE_2D,n,0,0,o,s,i,a),I.unbindTexture()},this.copyTextureToTexture=function(e,t,n=null,r=null,i=0,a=0){let o,s,c,l,u,d,f,p,m,h=e.isCompressedTexture?e.mipmaps[a]:e.image;if(n!==null)o=n.max.x-n.min.x,s=n.max.y-n.min.y,c=n.isBox3?n.max.z-n.min.z:1,l=n.min.x,u=n.min.y,d=n.isBox3?n.min.z:0;else{let t=2**-i;o=Math.floor(h.width*t),s=Math.floor(h.height*t),c=e.isDataArrayTexture?h.depth:e.isData3DTexture?Math.floor(h.depth*t):1,l=0,u=0,d=0}r===null?(f=0,p=0,m=0):(f=r.x,p=r.y,m=r.z);let g=ze.convert(t.format),_=ze.convert(t.type),v;t.isData3DTexture?(De.setTexture3D(t,0),v=F.TEXTURE_3D):t.isDataArrayTexture||t.isCompressedArrayTexture?(De.setTexture2DArray(t,0),v=F.TEXTURE_2D_ARRAY):(De.setTexture2D(t,0),v=F.TEXTURE_2D),I.activeTexture(F.TEXTURE0),I.pixelStorei(F.UNPACK_FLIP_Y_WEBGL,t.flipY),I.pixelStorei(F.UNPACK_PREMULTIPLY_ALPHA_WEBGL,t.premultiplyAlpha),I.pixelStorei(F.UNPACK_ALIGNMENT,t.unpackAlignment);let y=I.getParameter(F.UNPACK_ROW_LENGTH),b=I.getParameter(F.UNPACK_IMAGE_HEIGHT),x=I.getParameter(F.UNPACK_SKIP_PIXELS),S=I.getParameter(F.UNPACK_SKIP_ROWS),C=I.getParameter(F.UNPACK_SKIP_IMAGES);I.pixelStorei(F.UNPACK_ROW_LENGTH,h.width),I.pixelStorei(F.UNPACK_IMAGE_HEIGHT,h.height),I.pixelStorei(F.UNPACK_SKIP_PIXELS,l),I.pixelStorei(F.UNPACK_SKIP_ROWS,u),I.pixelStorei(F.UNPACK_SKIP_IMAGES,d);let w=e.isDataArrayTexture||e.isData3DTexture,T=t.isDataArrayTexture||t.isData3DTexture;if(e.isDepthTexture){let n=L.get(e),r=L.get(t),h=L.get(n.__renderTarget),g=L.get(r.__renderTarget);I.bindFramebuffer(F.READ_FRAMEBUFFER,h.__webglFramebuffer),I.bindFramebuffer(F.DRAW_FRAMEBUFFER,g.__webglFramebuffer);for(let n=0;n<c;n++)w&&(F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,L.get(e).__webglTexture,i,d+n),F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,L.get(t).__webglTexture,a,m+n)),F.blitFramebuffer(l,u,o,s,f,p,o,s,F.DEPTH_BUFFER_BIT,F.NEAREST);I.bindFramebuffer(F.READ_FRAMEBUFFER,null),I.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else if(i!==0||e.isRenderTargetTexture||L.has(e)){let n=L.get(e),r=L.get(t);I.bindFramebuffer(F.READ_FRAMEBUFFER,ee),I.bindFramebuffer(F.DRAW_FRAMEBUFFER,k);for(let e=0;e<c;e++)w?F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,n.__webglTexture,i,d+e):F.framebufferTexture2D(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,n.__webglTexture,i),T?F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,r.__webglTexture,a,m+e):F.framebufferTexture2D(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_2D,r.__webglTexture,a),i===0?T?F.copyTexSubImage3D(v,a,f,p,m+e,l,u,o,s):F.copyTexSubImage2D(v,a,f,p,l,u,o,s):F.blitFramebuffer(l,u,o,s,f,p,o,s,F.COLOR_BUFFER_BIT,F.NEAREST);I.bindFramebuffer(F.READ_FRAMEBUFFER,null),I.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else T?e.isDataTexture||e.isData3DTexture?F.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h.data):t.isCompressedArrayTexture?F.compressedTexSubImage3D(v,a,f,p,m,o,s,c,g,h.data):F.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h):e.isDataTexture?F.texSubImage2D(F.TEXTURE_2D,a,f,p,o,s,g,_,h.data):e.isCompressedTexture?F.compressedTexSubImage2D(F.TEXTURE_2D,a,f,p,h.width,h.height,g,h.data):F.texSubImage2D(F.TEXTURE_2D,a,f,p,o,s,g,_,h);I.pixelStorei(F.UNPACK_ROW_LENGTH,y),I.pixelStorei(F.UNPACK_IMAGE_HEIGHT,b),I.pixelStorei(F.UNPACK_SKIP_PIXELS,x),I.pixelStorei(F.UNPACK_SKIP_ROWS,S),I.pixelStorei(F.UNPACK_SKIP_IMAGES,C),a===0&&t.generateMipmaps&&F.generateMipmap(v),I.unbindTexture()},this.initRenderTarget=function(e){L.get(e).__webglFramebuffer===void 0&&De.setupRenderTarget(e)},this.initTexture=function(e){e.isCubeTexture?De.setTextureCube(e,0):e.isData3DTexture?De.setTexture3D(e,0):e.isDataArrayTexture||e.isCompressedArrayTexture?De.setTexture2DArray(e,0):De.setTexture2D(e,0),I.unbindTexture()},this.resetState=function(){te=0,ne=0,A=null,I.reset(),Be.reset()},typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}get coordinateSystem(){return tl}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=Yl._getDrawingBufferColorSpace(e),t.unpackColorSpace=Yl._getUnpackColorSpace()}},sv={name:`CopyShader`,uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;


		}`},cv=class{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error(`THREE.Pass: .render() must be implemented in derived pass.`)}dispose(){}},lv=new bm(-1,1,1,-1,0,1),uv=new class extends Ud{constructor(){super(),this.setAttribute(`position`,new jd([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute(`uv`,new jd([0,2,0,0,2,0],2))}},dv=class{constructor(e){this._mesh=new pf(uv,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,lv)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}},fv=class extends cv{constructor(e,t=`tDiffuse`){super(),this.textureID=t,this.uniforms=null,this.material=null,e instanceof Ip?(this.uniforms=e.uniforms,this.material=e):e&&(this.uniforms=Np.clone(e.uniforms),this.material=new Ip({name:e.name===void 0?`unspecified`:e.name,defines:Object.assign({},e.defines),uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader})),this._fsQuad=new dv(this.material)}render(e,t,n){this.uniforms[this.textureID]&&(this.uniforms[this.textureID].value=n.texture),this._fsQuad.material=this.material,this.renderToScreen?(e.setRenderTarget(null),this._fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this._fsQuad.render(e))}dispose(){this.material.dispose(),this._fsQuad.dispose()}},pv=class extends cv{constructor(e,t){super(),this.scene=e,this.camera=t,this.clear=!0,this.needsSwap=!1,this.inverse=!1}render(e,t,n){let r=e.getContext(),i=e.state;i.buffers.color.setMask(!1),i.buffers.depth.setMask(!1),i.buffers.color.setLocked(!0),i.buffers.depth.setLocked(!0);let a,o;this.inverse?(a=0,o=1):(a=1,o=0),i.buffers.stencil.setTest(!0),i.buffers.stencil.setOp(r.REPLACE,r.REPLACE,r.REPLACE),i.buffers.stencil.setFunc(r.ALWAYS,a,4294967295),i.buffers.stencil.setClear(o),i.buffers.stencil.setLocked(!0),e.setRenderTarget(n),this.clear&&e.clear(),e.render(this.scene,this.camera),e.setRenderTarget(t),this.clear&&e.clear(),e.render(this.scene,this.camera),i.buffers.color.setLocked(!1),i.buffers.depth.setLocked(!1),i.buffers.color.setMask(!0),i.buffers.depth.setMask(!0),i.buffers.stencil.setLocked(!1),i.buffers.stencil.setFunc(r.EQUAL,1,4294967295),i.buffers.stencil.setOp(r.KEEP,r.KEEP,r.KEEP),i.buffers.stencil.setLocked(!0)}},mv=class extends cv{constructor(){super(),this.needsSwap=!1}render(e){e.state.buffers.stencil.setLocked(!1),e.state.buffers.stencil.setTest(!1)}},hv=class{constructor(e,t){if(this.renderer=e,this._pixelRatio=e.getPixelRatio(),t===void 0){let n=e.getSize(new Z);this._width=n.width,this._height=n.height,t=new cu(this._width*this._pixelRatio,this._height*this._pixelRatio,{type:Hs}),t.texture.name=`EffectComposer.rt1`}else this._width=t.width,this._height=t.height;this.renderTarget1=t,this.renderTarget2=t.clone(),this.renderTarget2.texture.name=`EffectComposer.rt2`,this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2,this.renderToScreen=!0,this.passes=[],this.copyPass=new fv(sv),this.copyPass.material.blending=0,this.timer=new Om}swapBuffers(){let e=this.readBuffer;this.readBuffer=this.writeBuffer,this.writeBuffer=e}addPass(e){this.passes.push(e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}insertPass(e,t){this.passes.splice(t,0,e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}removePass(e){let t=this.passes.indexOf(e);t!==-1&&this.passes.splice(t,1)}isLastEnabledPass(e){for(let t=e+1;t<this.passes.length;t++)if(this.passes[t].enabled)return!1;return!0}render(e){this.timer.update(),e===void 0&&(e=this.timer.getDelta());let t=this.renderer.getRenderTarget(),n=!1;for(let t=0,r=this.passes.length;t<r;t++){let r=this.passes[t];if(r.enabled!==!1){if(r.renderToScreen=this.renderToScreen&&this.isLastEnabledPass(t),r.render(this.renderer,this.writeBuffer,this.readBuffer,e,n),r.needsSwap){if(n){let t=this.renderer.getContext(),n=this.renderer.state.buffers.stencil;n.setFunc(t.NOTEQUAL,1,4294967295),this.copyPass.render(this.renderer,this.writeBuffer,this.readBuffer,e),n.setFunc(t.EQUAL,1,4294967295)}this.swapBuffers()}pv!==void 0&&(r instanceof pv?n=!0:r instanceof mv&&(n=!1))}}this.renderer.setRenderTarget(t)}reset(e){if(e===void 0){let t=this.renderer.getSize(new Z);this._pixelRatio=this.renderer.getPixelRatio(),this._width=t.width,this._height=t.height,e=this.renderTarget1.clone(),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.renderTarget1=e,this.renderTarget2=e.clone(),this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2}setSize(e,t){this._width=e,this._height=t;let n=this._width*this._pixelRatio,r=this._height*this._pixelRatio;this.renderTarget1.setSize(n,r),this.renderTarget2.setSize(n,r);for(let e=0;e<this.passes.length;e++)this.passes[e].setSize(n,r)}setPixelRatio(e){this._pixelRatio=e,this.setSize(this._width,this._height)}dispose(){this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.copyPass.dispose()}},gv=class extends cv{constructor(e,t,n=null,r=null,i=null){super(),this.scene=e,this.camera=t,this.overrideMaterial=n,this.clearColor=r,this.clearAlpha=i,this.clear=!0,this.clearDepth=!1,this.needsSwap=!1,this.isRenderPass=!0,this._oldClearColor=new Ku}render(e,t,n){let r=e.autoClear;e.autoClear=!1;let i,a;this.overrideMaterial!==null&&(a=this.scene.overrideMaterial,this.scene.overrideMaterial=this.overrideMaterial),this.clearColor!==null&&(e.getClearColor(this._oldClearColor),e.setClearColor(this.clearColor,e.getClearAlpha())),this.clearAlpha!==null&&(i=e.getClearAlpha(),e.setClearAlpha(this.clearAlpha)),this.clearDepth==1&&e.clearDepth(),e.setRenderTarget(this.renderToScreen?null:n),this.clear===!0&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),e.render(this.scene,this.camera),this.clearColor!==null&&e.setClearColor(this._oldClearColor),this.clearAlpha!==null&&e.setClearAlpha(i),this.overrideMaterial!==null&&(this.scene.overrideMaterial=a),e.autoClear=r}},_v={name:`LuminosityHighPassShader`,uniforms:{tDiffuse:{value:null},luminosityThreshold:{value:1},smoothWidth:{value:1},defaultColor:{value:new Ku(0)},defaultOpacity:{value:0}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform sampler2D tDiffuse;
		uniform vec3 defaultColor;
		uniform float defaultOpacity;
		uniform float luminosityThreshold;
		uniform float smoothWidth;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );

			float v = luminance( texel.xyz );

			vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );

			float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );

			gl_FragColor = mix( outputColor, texel, alpha );

		}`},vv=class e extends cv{constructor(e,t=1,n,r){super(),this.strength=t,this.radius=n,this.threshold=r,this.resolution=e===void 0?new Z(256,256):new Z(e.x,e.y),this.clearColor=new Ku(0,0,0),this.needsSwap=!1,this.renderTargetsHorizontal=[],this.renderTargetsVertical=[],this.nMips=5;let i=Math.round(this.resolution.x/2),a=Math.round(this.resolution.y/2);this.renderTargetBright=new cu(i,a,{type:Hs}),this.renderTargetBright.texture.name=`UnrealBloomPass.bright`,this.renderTargetBright.texture.generateMipmaps=!1;for(let e=0;e<this.nMips;e++){let t=new cu(i,a,{type:Hs});t.texture.name=`UnrealBloomPass.h`+e,t.texture.generateMipmaps=!1,this.renderTargetsHorizontal.push(t);let n=new cu(i,a,{type:Hs});n.texture.name=`UnrealBloomPass.v`+e,n.texture.generateMipmaps=!1,this.renderTargetsVertical.push(n),i=Math.round(i/2),a=Math.round(a/2)}let o=_v;this.highPassUniforms=Np.clone(o.uniforms),this.highPassUniforms.luminosityThreshold.value=r,this.highPassUniforms.smoothWidth.value=.01,this.materialHighPassFilter=new Ip({uniforms:this.highPassUniforms,vertexShader:o.vertexShader,fragmentShader:o.fragmentShader}),this.separableBlurMaterials=[];let s=[6,10,14,18,22];i=Math.round(this.resolution.x/2),a=Math.round(this.resolution.y/2);for(let e=0;e<this.nMips;e++)this.separableBlurMaterials.push(this._getSeparableBlurMaterial(s[e])),this.separableBlurMaterials[e].uniforms.invSize.value=new Z(1/i,1/a),i=Math.round(i/2),a=Math.round(a/2);this.compositeMaterial=this._getCompositeMaterial(this.nMips),this.compositeMaterial.uniforms.blurTexture1.value=this.renderTargetsVertical[0].texture,this.compositeMaterial.uniforms.blurTexture2.value=this.renderTargetsVertical[1].texture,this.compositeMaterial.uniforms.blurTexture3.value=this.renderTargetsVertical[2].texture,this.compositeMaterial.uniforms.blurTexture4.value=this.renderTargetsVertical[3].texture,this.compositeMaterial.uniforms.blurTexture5.value=this.renderTargetsVertical[4].texture,this.compositeMaterial.uniforms.bloomStrength.value=t,this.compositeMaterial.uniforms.bloomRadius.value=.1;let c=[1,.8,.6,.4,.2];this.compositeMaterial.uniforms.bloomFactors.value=c,this.bloomTintColors=[new Q(1,1,1),new Q(1,1,1),new Q(1,1,1),new Q(1,1,1),new Q(1,1,1)],this.compositeMaterial.uniforms.bloomTintColors.value=this.bloomTintColors,this.copyUniforms=Np.clone(sv.uniforms),this.blendMaterial=new Ip({uniforms:this.copyUniforms,vertexShader:sv.vertexShader,fragmentShader:sv.fragmentShader,premultipliedAlpha:!0,blending:2,depthTest:!1,depthWrite:!1,transparent:!0}),this._oldClearColor=new Ku,this._oldClearAlpha=1,this._basic=new ef,this._fsQuad=new dv(null)}dispose(){for(let e=0;e<this.renderTargetsHorizontal.length;e++)this.renderTargetsHorizontal[e].dispose();for(let e=0;e<this.renderTargetsVertical.length;e++)this.renderTargetsVertical[e].dispose();this.renderTargetBright.dispose();for(let e=0;e<this.separableBlurMaterials.length;e++)this.separableBlurMaterials[e].dispose();this.compositeMaterial.dispose(),this.blendMaterial.dispose(),this._basic.dispose(),this._fsQuad.dispose()}setSize(e,t){let n=Math.round(e/2),r=Math.round(t/2);this.renderTargetBright.setSize(n,r);for(let e=0;e<this.nMips;e++)this.renderTargetsHorizontal[e].setSize(n,r),this.renderTargetsVertical[e].setSize(n,r),this.separableBlurMaterials[e].uniforms.invSize.value=new Z(1/n,1/r),n=Math.round(n/2),r=Math.round(r/2)}render(t,n,r,i,a){t.getClearColor(this._oldClearColor),this._oldClearAlpha=t.getClearAlpha();let o=t.autoClear;t.autoClear=!1,t.setClearColor(this.clearColor,0),a&&t.state.buffers.stencil.setTest(!1),this.renderToScreen&&(this._fsQuad.material=this._basic,this._basic.map=r.texture,t.setRenderTarget(null),t.clear(),this._fsQuad.render(t)),this.highPassUniforms.tDiffuse.value=r.texture,this.highPassUniforms.luminosityThreshold.value=this.threshold,this._fsQuad.material=this.materialHighPassFilter,t.setRenderTarget(this.renderTargetBright),t.clear(),this._fsQuad.render(t);let s=this.renderTargetBright;for(let n=0;n<this.nMips;n++)this._fsQuad.material=this.separableBlurMaterials[n],this.separableBlurMaterials[n].uniforms.colorTexture.value=s.texture,this.separableBlurMaterials[n].uniforms.direction.value=e.BlurDirectionX,t.setRenderTarget(this.renderTargetsHorizontal[n]),t.clear(),this._fsQuad.render(t),this.separableBlurMaterials[n].uniforms.colorTexture.value=this.renderTargetsHorizontal[n].texture,this.separableBlurMaterials[n].uniforms.direction.value=e.BlurDirectionY,t.setRenderTarget(this.renderTargetsVertical[n]),t.clear(),this._fsQuad.render(t),s=this.renderTargetsVertical[n];this._fsQuad.material=this.compositeMaterial,this.compositeMaterial.uniforms.bloomStrength.value=this.strength,this.compositeMaterial.uniforms.bloomRadius.value=this.radius,this.compositeMaterial.uniforms.bloomTintColors.value=this.bloomTintColors,t.setRenderTarget(this.renderTargetsHorizontal[0]),t.clear(),this._fsQuad.render(t),this._fsQuad.material=this.blendMaterial,this.copyUniforms.tDiffuse.value=this.renderTargetsHorizontal[0].texture,a&&t.state.buffers.stencil.setTest(!0),this.renderToScreen?(t.setRenderTarget(null),this._fsQuad.render(t)):(t.setRenderTarget(r),this._fsQuad.render(t)),t.setClearColor(this._oldClearColor,this._oldClearAlpha),t.autoClear=o}_getSeparableBlurMaterial(e){let t=[],n=e/3;for(let r=0;r<e;r++)t.push(.39894*Math.exp(-.5*r*r/(n*n))/n);return new Ip({defines:{KERNEL_RADIUS:e},uniforms:{colorTexture:{value:null},invSize:{value:new Z(.5,.5)},direction:{value:new Z(.5,.5)},gaussianCoefficients:{value:t}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`

				#include <common>

				varying vec2 vUv;

				uniform sampler2D colorTexture;
				uniform vec2 invSize;
				uniform vec2 direction;
				uniform float gaussianCoefficients[KERNEL_RADIUS];

				void main() {

					float weightSum = gaussianCoefficients[0];
					vec3 diffuseSum = texture2D( colorTexture, vUv ).rgb * weightSum;

					for ( int i = 1; i < KERNEL_RADIUS; i ++ ) {

						float x = float( i );
						float w = gaussianCoefficients[i];
						vec2 uvOffset = direction * invSize * x;
						vec3 sample1 = texture2D( colorTexture, vUv + uvOffset ).rgb;
						vec3 sample2 = texture2D( colorTexture, vUv - uvOffset ).rgb;
						diffuseSum += ( sample1 + sample2 ) * w;

					}

					gl_FragColor = vec4( diffuseSum, 1.0 );

				}`})}_getCompositeMaterial(e){return new Ip({defines:{NUM_MIPS:e},uniforms:{blurTexture1:{value:null},blurTexture2:{value:null},blurTexture3:{value:null},blurTexture4:{value:null},blurTexture5:{value:null},bloomStrength:{value:1},bloomFactors:{value:null},bloomTintColors:{value:null},bloomRadius:{value:0}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`

				varying vec2 vUv;

				uniform sampler2D blurTexture1;
				uniform sampler2D blurTexture2;
				uniform sampler2D blurTexture3;
				uniform sampler2D blurTexture4;
				uniform sampler2D blurTexture5;
				uniform float bloomStrength;
				uniform float bloomRadius;
				uniform float bloomFactors[NUM_MIPS];
				uniform vec3 bloomTintColors[NUM_MIPS];

				float lerpBloomFactor( const in float factor ) {

					float mirrorFactor = 1.2 - factor;
					return mix( factor, mirrorFactor, bloomRadius );

				}

				void main() {

					// 3.0 for backwards compatibility with previous alpha-based intensity
					vec3 bloom = 3.0 * bloomStrength * (
						lerpBloomFactor( bloomFactors[ 0 ] ) * bloomTintColors[ 0 ] * texture2D( blurTexture1, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 1 ] ) * bloomTintColors[ 1 ] * texture2D( blurTexture2, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 2 ] ) * bloomTintColors[ 2 ] * texture2D( blurTexture3, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 3 ] ) * bloomTintColors[ 3 ] * texture2D( blurTexture4, vUv ).rgb +
						lerpBloomFactor( bloomFactors[ 4 ] ) * bloomTintColors[ 4 ] * texture2D( blurTexture5, vUv ).rgb
					);

					float bloomAlpha = max( bloom.r, max( bloom.g, bloom.b ) );
					gl_FragColor = vec4( bloom, bloomAlpha );

				}`})}};vv.BlurDirectionX=new Z(1,0),vv.BlurDirectionY=new Z(0,1);var yv={name:`OutputShader`,uniforms:{tDiffuse:{value:null},toneMappingExposure:{value:1}},vertexShader:`
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#elif defined( CUSTOM_TONE_MAPPING )

				gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`},bv=class extends cv{constructor(){super(),this.isOutputPass=!0,this.uniforms=Np.clone(yv.uniforms),this.material=new Lp({name:yv.name,uniforms:this.uniforms,vertexShader:yv.vertexShader,fragmentShader:yv.fragmentShader}),this._fsQuad=new dv(this.material),this._outputColorSpace=null,this._toneMapping=null}render(e,t,n){this.uniforms.tDiffuse.value=n.texture,this.uniforms.toneMappingExposure.value=e.toneMappingExposure,(this._outputColorSpace!==e.outputColorSpace||this._toneMapping!==e.toneMapping)&&(this._outputColorSpace=e.outputColorSpace,this._toneMapping=e.toneMapping,this.material.defines={},Yl.getTransfer(this._outputColorSpace)===`srgb`&&(this.material.defines.SRGB_TRANSFER=``),this._toneMapping===1?this.material.defines.LINEAR_TONE_MAPPING=``:this._toneMapping===2?this.material.defines.REINHARD_TONE_MAPPING=``:this._toneMapping===3?this.material.defines.CINEON_TONE_MAPPING=``:this._toneMapping===4?this.material.defines.ACES_FILMIC_TONE_MAPPING=``:this._toneMapping===6?this.material.defines.AGX_TONE_MAPPING=``:this._toneMapping===7?this.material.defines.NEUTRAL_TONE_MAPPING=``:this._toneMapping===5&&(this.material.defines.CUSTOM_TONE_MAPPING=``),this.material.needsUpdate=!0),this.renderToScreen===!0?(e.setRenderTarget(null),this._fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this._fsQuad.render(e))}dispose(){this.material.dispose(),this._fsQuad.dispose()}},xv=.3,Sv=.3;function Cv(e,t,n,r){let i=new qf(e,t,6,14);r.push(i);let a=new pf(i,n);return a.castShadow=!0,a}function wv(e,t,n,r=18,i=14){let a=new Ep(e,r,i);n.push(a);let o=new pf(a,t);return o.castShadow=!0,o}function Tv(e,t,n,r,i){let a=new Kf(e,t,n);i.push(a);let o=new pf(a,r);return o.castShadow=!0,o}function Ev(e){let t=[],n=new zp({color:e.skin,roughness:.58,metalness:.02,clearcoat:.25,clearcoatRoughness:.6}),r=new Rp({color:e.skinShadow,roughness:.58,metalness:.02}),i=new Rp({color:e.trunks,roughness:.34,metalness:.05}),a=new Rp({color:e.trunkTrim,roughness:.4,metalness:.1}),o=new Rp({color:e.glove,roughness:.28,metalness:.04}),s=new Rp({color:e.gloveTrim,roughness:.45}),c=new Rp({color:e.hair,roughness:.72}),l=new Rp({color:e.shoe,roughness:.5}),u=new Rp({color:4856918,roughness:.9,transparent:!0,opacity:0}),d=u.clone(),f=u.clone(),p=new Rp({color:8326420,roughness:.6,transparent:!0,opacity:0,emissive:2753286}),m=p.clone(),h=new Rp({color:7026034,roughness:.75,transparent:!0,opacity:0}),g=h.clone(),_=h.clone(),v=h.clone(),y=new Rp({color:9047830,roughness:.35,transparent:!0,opacity:0,emissive:3146762}),b=y.clone(),x=y.clone(),S=y.clone(),C=new Rp({color:6038608,roughness:.85,transparent:!0,opacity:0}),w=C.clone(),T=[n,r,i,a,o,s,c,l,u,d,f,p,m,h,g,_,v,y,b,x,S,C,w],E=new zu;E.name=`boxer`;let D=new zu;D.name=`hips`,D.position.y=.98,E.add(D);let O=Cv(.145,.1,i,t);O.scale.set(1.18,1,.88),O.position.y=.02,D.add(O);let ee=new pf(new Yf(.168,.172,.035,18),a);t.push(ee.geometry),ee.scale.set(1.05,1,.82),ee.position.y=.1,ee.castShadow=!0,D.add(ee);let k=new zu;k.name=`spine`,k.position.y=.1,D.add(k);let te=new zu;te.name=`chest`,k.add(te);let ne=Cv(.16,.2,n,t);ne.scale.set(1.3,1,.82),ne.position.y=.19,te.add(ne);let A=Cv(.125,.1,n,t);A.scale.set(1.22,1,.8),A.position.y=.02,te.add(A);let re=wv(.062,n,t);re.scale.set(1.05,.78,.6),re.position.set(.085,.26,.115),te.add(re);let ie=re.clone();ie.position.x=-.085,te.add(ie);let ae=wv(.075,n,t);ae.position.set(.215,.315,0),te.add(ae);let oe=ae.clone();oe.position.x=-.215,te.add(oe);let j=wv(.1,f,t);j.scale.set(1.05,1.35,.55),j.position.set(.02,.05,.1),j.castShadow=!1,te.add(j);let se=new zu;se.name=`head`,se.position.y=.44,te.add(se);let ce=new pf(new Yf(.052,.062,.09,12),r);t.push(ce.geometry),ce.position.y=.02,ce.castShadow=!0,se.add(ce);let le=wv(.115,n,t,22,18);le.scale.set(.92,1.08,.98),le.position.y=.135,se.add(le);let M=wv(.085,n,t,16,12);M.scale.set(.85,.72,.9),M.position.set(0,.075,.028),se.add(M);let ue=Tv(.032,.045,.035,r,t);ue.position.set(0,.12,.112),se.add(ue);let de=Tv(.052,.016,.02,r,t);de.position.set(.048,.165,.1),se.add(de);let fe=de.clone();fe.position.x=-.048,se.add(fe);let pe=wv(.026,r,t,10,8);pe.scale.set(.5,1,.75),pe.position.set(.104,.125,.01),se.add(pe);let me=pe.clone();me.position.x=-.104,se.add(me);let he=new Rp({color:1315344,roughness:.35});T.push(he);let ge=wv(.016,he,t,8,8);ge.position.set(.045,.145,.102),se.add(ge);let _e=ge.clone();_e.position.x=-.045,se.add(_e);let ve=wv(.118,c,t,20,14);ve.scale.set(.94,.98,1),ve.position.set(0,.165,-.018),se.add(ve);let ye=wv(.112,c,t,18,12);ye.scale.set(.9,.58,.95),ye.position.set(0,.198,.012),se.add(ye);let be=wv(.042,u,t,12,10);be.scale.set(1,.72,.5),be.position.set(.05,.15,.085),be.castShadow=!1,se.add(be);let N=wv(.042,d,t,12,10);N.scale.set(1,.72,.5),N.position.set(-.05,.15,.085),N.castShadow=!1,se.add(N);let xe=Tv(.05,.008,.01,p,t);xe.position.set(.05,.178,.104),xe.castShadow=!1,se.add(xe);let P=Tv(.05,.008,.01,m,t);P.position.set(-.05,.178,.104),P.castShadow=!1,se.add(P);let Se=wv(.035,h,t,12,10);Se.position.set(.052,.155,.088),Se.castShadow=!1,se.add(Se);let F=wv(.035,g,t,12,10);F.position.set(-.052,.155,.088),F.castShadow=!1,se.add(F);let Ce=wv(.028,_,t,10,8);Ce.position.set(.068,.095,.075),Ce.castShadow=!1,se.add(Ce);let we=wv(.028,v,t,10,8);we.position.set(-.068,.095,.075),we.castShadow=!1,se.add(we);let Te=Tv(.014,.1,.006,y,t);Te.position.set(.052,.115,.106),Te.castShadow=!1,se.add(Te);let I=Tv(.014,.1,.006,b,t);I.position.set(-.052,.115,.106),I.castShadow=!1,se.add(I);let Ee=Tv(.011,.07,.006,x,t);Ee.position.set(.008,.075,.118),Ee.castShadow=!1,se.add(Ee);let L=Tv(.03,.012,.006,S,t);L.position.set(.02,.052,.104),L.castShadow=!1,se.add(L);let De=wv(.09,C,t,12,10);De.scale.set(.5,1.2,.7),De.position.set(.16,.08,.02),De.castShadow=!1,te.add(De);let Oe=wv(.09,w,t,12,10);Oe.scale.set(.5,1.2,.7),Oe.position.set(-.16,.08,.02),Oe.castShadow=!1,te.add(Oe);let R=e=>{let r=new zu;r.name=e===1?`shoulderL`:`shoulderR`,r.position.set(.215*e,.315,0),te.add(r);let i=Cv(.056,xv-.12,n,t);i.position.y=-.3/2,r.add(i);let a=new zu;a.name=e===1?`elbowL`:`elbowR`,a.position.y=-.3,r.add(a);let c=Cv(.048,Sv-.13,n,t);c.position.y=-.13999999999999999,a.add(c);let l=new zu;l.name=e===1?`gloveL`:`gloveR`,l.position.y=-.3,a.add(l);let u=new pf(new Yf(.055,.062,.07,12),s);t.push(u.geometry),u.position.y=.01,u.castShadow=!0,l.add(u);let d=wv(.088,o,t,18,14);return d.scale.set(1,1.12,1.3),d.position.set(0,-.05,.02),l.add(d),{shoulder:r,elbow:a,glove:l,gloveMesh:d}},ke=R(1),z=R(-1),Ae=e=>{let r=new zu;r.name=e===1?`hipL`:`hipR`,r.position.set(.105*e,-.02,0),D.add(r);let a=Cv(.078,.24,n,t);a.position.y=-.21,r.add(a);let o=Cv(.092,.16,i,t);o.position.y=-.14,r.add(o);let s=new zu;s.name=e===1?`kneeL`:`kneeR`,s.position.y=-.44,r.add(s);let c=Cv(.058,.24,n,t);c.position.y=-.21,s.add(c);let u=new zu;u.name=e===1?`ankleL`:`ankleR`,u.position.y=-.44,s.add(u);let d=Tv(.095,.075,.26,l,t);d.position.set(0,-.035,.055),u.add(d);let f=new pf(new Yf(.052,.058,.08,10),l);return t.push(f.geometry),f.position.y=.01,f.castShadow=!0,u.add(f),{hip:r,knee:s,ankle:u}},je=Ae(1),Me=Ae(-1);return{root:E,hips:D,spine:k,chest:te,head:se,shoulderL:ke.shoulder,elbowL:ke.elbow,gloveL:ke.glove,shoulderR:z.shoulder,elbowR:z.elbow,gloveR:z.glove,hipL:je.hip,kneeL:je.knee,ankleL:je.ankle,hipR:Me.hip,kneeR:Me.knee,ankleR:Me.ankle,chestMesh:ne,headMesh:le,browL:de,browR:fe,bruiseL:be,bruiseR:N,bodyBruise:j,cutL:xe,cutR:P,swellL:Se,swellR:F,cheekL:Ce,cheekR:we,streakL:Te,streakR:I,noseStreak:Ee,mouthBlood:L,ribL:De,ribR:Oe,gloveLMesh:ke.gloveMesh,gloveRMesh:z.gloveMesh,gloveLMaterial:o,gloveRMaterial:o,gloveBaseColor:new Ku(e.glove),materials:T,geometries:t}}var Dv=new Q,Ov=new Q,kv=new Q,Av=new Q,jv=new Q,Mv=new Q,Nv=new Q(0,-1,0),Pv=new Q;function Fv(e,t,n,r){let i=xv,a=.36;Dv.copy(e),Ov.copy(t),kv.subVectors(Ov,Dv);let o=Bl.clamp(kv.length(),.12,.6449999999999999);kv.normalize();let s=(i*i-a*a+o*o)/(2*o),c=Math.sqrt(Math.max(1e-4,i*i-s*s));Mv.copy(n).normalize(),Av.copy(Mv).addScaledVector(kv,-Mv.dot(kv)),Av.lengthSq()<1e-4&&Av.set(0,-1,0).addScaledVector(kv,kv.y),Av.normalize(),jv.copy(Dv).addScaledVector(kv,s).addScaledVector(Av,c),r.elbowWorld.copy(jv),Pv.copy(Dv).addScaledVector(kv,o),r.targetWorld.copy(Pv)}var Iv=new Q,Lv=new Vl,Rv=new Vl;function zv(e,t,n,r=0){if(Iv.subVectors(n,t),Iv.lengthSq()<1e-6)return;if(Iv.normalize(),Rv.setFromUnitVectors(Nv,Iv),r!==0){let e=new Vl().setFromAxisAngle(Iv,r);Rv.premultiply(e)}let i=e.parent;if(i===null){e.quaternion.copy(Rv);return}i.getWorldQuaternion(Lv),e.quaternion.copy(Lv.invert().multiply(Rv))}function Bv(){let e=Ev({skin:13081462,skinShadow:11041884,trunks:1316380,trunkTrim:1316380,glove:13081462,gloveTrim:15264236,hair:2827040,shoe:1052948}),t=new Rp({color:12568015,roughness:.72}),n=new Rp({color:1316380,roughness:.7}),r=new pf(new qf(.175,.24,6,14),t);r.scale.set(1.28,1,.85),r.position.y=.15,r.castShadow=!0,e.chest.add(r);let i=new pf(new Yf(.07,.09,.05,12),t);i.position.y=.42,e.chest.add(i);let a=new pf(new Kf(.07,.025,.02),n);a.position.set(0,.4,.09),e.chest.add(a);let o=[r.geometry,i.geometry,a.geometry];for(let n of[e.shoulderL,e.shoulderR]){let e=new pf(new qf(.062,.16,4,10),t);e.position.y=-.12,e.castShadow=!0,n.add(e),o.push(e.geometry)}for(let t of[e.hipL,e.hipR]){let e=new pf(new qf(.088,.26,4,10),n);e.position.y=-.21,e.castShadow=!0,t.add(e),o.push(e.geometry)}for(let t of[e.kneeL,e.kneeR]){let e=new pf(new qf(.066,.26,4,10),n);e.position.y=-.21,e.castShadow=!0,t.add(e),o.push(e.geometry)}return e.geometries.push(...o),e.materials.push(t,n),e}function Vv(e){for(let t of e.geometries)t.dispose();for(let t of e.materials)t.dispose()}var Hv=new Q(.1,.27,.27),Uv=new Q(-.09,.29,.23),Wv=new Q(.13,0,.26),Gv=new Q(-.11,.02,.22),Kv=new Q(.13,.1,.28),qv=new Q(-.11,.14,.24),Jv={jab:.3,straight:.38,hook:.44,uppercut:.46},Yv=.33,Xv=-.02;function Zv(e,t,n){let r=n===`power`?.12:0,i=t===`head`?Yv:Xv;switch(e){case`jab`:return new Q(.06,i,.56+r*.5);case`straight`:return new Q(-.04,i,.62+r*.5);case`hook`:return new Q(-.3,i+.02,.48+r*.4);case`uppercut`:return new Q(0,i+.1,.46+r*.4)}}var Qv=(e,t,n,r)=>e+(t-e)*(1-Math.exp(-n*r)),$v=(e,t,n,r)=>e+(((t-e+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI)*(1-Math.exp(-n*r)),ey=(e,t,n)=>{let r=Math.max(0,Math.min(1,(n-e)/(t-e)));return r*r*(3-2*r)},ty=new Q,ny=new Q,ry=new Q,iy={elbowWorld:new Q,targetWorld:new Q},ay=new Q,oy=new Q,sy=new Q,cy=new Q,ly=new Q,uy=new Q,dy=new Vl,fy={full:1,reduced:.45,off:0},py=new Ku(6031886),my=class{rig;mapping;yaw=0;punchT=1;punchKind=null;punchHand=`left`;punchTargetKind=`head`;punchPower=`normal`;activeAction=null;downAmount=0;reactionT=1;reactionDirection=1;reactionPower=0;walkPhase=0;gloveLCurrent=new Q().copy(Kv);gloveRCurrent=new Q().copy(qv);hipsRoll=0;spinePitch=0;spineTwist=0;drop=0;constructor(e,t){this.rig=e,this.mapping=t}impact(e){(e.amount>this.reactionPower||this.reactionT>.4)&&(this.reactionT=0,this.reactionDirection=e.direction,this.reactionPower=Math.max(this.reactionPower*.4,e.amount))}update(e,t,n,r,i,a=`full`){let o=this.rig,s=e.stance===`orthodox`?1:-1,c=this.mapping.x(e.x),l=this.mapping.z(e.y),u=Math.atan2(this.mapping.x(t.x)-c,(this.mapping.z(t.y)-l)*.45);this.yaw=$v(this.yaw,u,7,n),e.action!==this.activeAction&&(e.action!==null&&(this.punchT=0,this.punchKind=e.action,this.punchHand=e.action_hand??(e.stance===`orthodox`?`left`:`right`),this.punchTargetKind=e.action_target??`head`,this.punchPower=e.action_power??`normal`),this.activeAction=e.action);let d=this.punchKind===null?1:Jv[this.punchKind]*(this.punchPower===`power`?1.3:1);this.punchT=Math.min(1,this.punchT+n/d);let f=1-e.stamina/Math.max(1,e.maximum_stamina),p=Math.hypot(e.velocity_x,e.velocity_y)*.006;this.walkPhase+=p*n*4.4;let m=+!!e.is_downed,h=e.is_downed?2.6:1.5;this.downAmount=Qv(this.downAmount,m,h,n);let g=ey(0,1,this.downAmount);this.reactionT=Math.min(1,this.reactionT+n/.42);let _=(1-ey(0,1,this.reactionT))*Math.min(1,this.reactionPower/220),v=Math.min(1,e.stunned_ticks/45),y=i?0:Math.sin(r*8.6)*.05*v,b=i||g>.5?0:Math.sin(r*(4.6-f*1.6)+this.walkPhase*.5)*(.014+f*.012),x=i?0:Math.sin(r*(2.2+f*2.6))*(.012+f*.03),S=0,C=0,w=0;e.defense===`weave`?(S=-.24,C=.34*s,w=.3):e.defense===`slip_left`?(C=.2,w=.06):e.defense===`slip_right`?(C=-.2,w=.06):e.defense===`pull`&&(w=-.3),e.is_foul_recovery_target&&(S=-.18,w=.42),(e.clinch_ticks>0||e.clinch_startup_ticks>0)&&(w=.4,S=-.06),S-=_*.05,w-=_*.34,C+=y,this.drop=Qv(this.drop,S,12,n),this.hipsRoll=Qv(this.hipsRoll,C,12,n),this.spinePitch=Qv(this.spinePitch,w,11,n);let T=0;if(this.punchT<1&&this.punchKind!==null){let e=ey(.16,.5,this.punchT)*(1-ey(.6,1,this.punchT));this.punchKind===`straight`&&(T=-.42*e*(this.punchHand===`left`?1:-1)*s),this.punchKind===`hook`&&(T=.4*e*(this.punchHand===`left`?1:-1)*s),this.punchKind===`uppercut`&&(T=-.2*e*(this.punchHand===`left`?1:-1)*s),this.punchKind===`jab`&&(T=.24*e*(this.punchHand===`left`?1:-1)*s)}this.spineTwist=Qv(this.spineTwist,T,16,n);let E=.34*s;o.root.position.set(c,0,l),o.root.rotation.set(0,this.yaw+E*(1-g),0);let D=this.reactionDirection>=0?1:-1;o.hips.position.y=.98+b+this.drop*(1-g)-g*.82,o.hips.rotation.set(-g*(Math.PI/2-.12)+this.spinePitch*.35*(1-g),0,this.hipsRoll*.5*(1-g)+g*.15*D),o.spine.rotation.set(this.spinePitch*(1-g),this.spineTwist*(1-g),this.hipsRoll*.55*(1-g));let O=-this.spinePitch*.7-_*.55+g*.3,ee=-this.hipsRoll*.8+_*.3*(this.reactionDirection>=0?-1:1);o.head.rotation.set(O,-this.spineTwist*.5,ee),o.chest.scale.set(1+x,1+x*.5,1+x),this.poseLegs(e,p,g,D,s),o.root.updateMatrixWorld(!0);let k=e.defense===`guard_high`?Hv:e.defense===`guard_low`?Wv:Kv,te=e.defense===`guard_high`?Uv:e.defense===`guard_low`?Gv:qv,ne=oy.copy(k),A=sy.copy(te);if(e.is_foul_recovery_target&&(ne.set(.08,.32,.2),A.set(-.06,.3,.18)),(e.clinch_ticks>0||e.clinch_startup_ticks>0)&&(ne.set(.16,-.05,.5),A.set(-.16,-.02,.48)),g>.03?(ne.lerp(ty.set(.5,.28,-.1),g),A.lerp(ty.set(-.48,.3,.05),g)):v>.15&&(ne.lerp(ty.set(.3,-.25,.15),v*.7),A.lerp(ty.set(-.3,-.22,.15),v*.7)),this.punchT<1&&this.punchKind!==null&&g<.85){let e=ey(0,.2,this.punchT)*(1-ey(.16,.45,this.punchT)),t=ey(.18,this.punchKind===`jab`?.42:.5,this.punchT)*(1-ey(.62,1,this.punchT))*(1-g),n=cy.copy(Zv(this.punchKind,this.punchTargetKind,this.punchPower));if(this.punchKind===`hook`){let e=ey(.18,.55,this.punchT);n.x=Bl.lerp(-.62,-.1,e)*(this.punchHand===`left`?1:-1)*-1,n.z=.5+.14*e}let r=uy.set(0,this.punchKind===`uppercut`?-.22:-.03,-.16).multiplyScalar(e),i=this.punchHand===`left`?ne:A,a=ly.copy(i).add(r).lerp(n,t);i.copy(a)}ne.x*=s,A.x*=s,this.gloveLCurrent.x=Qv(this.gloveLCurrent.x,ne.x,22,n),this.gloveLCurrent.y=Qv(this.gloveLCurrent.y,ne.y,22,n),this.gloveLCurrent.z=Qv(this.gloveLCurrent.z,ne.z,22,n),this.gloveRCurrent.x=Qv(this.gloveRCurrent.x,A.x,22,n),this.gloveRCurrent.y=Qv(this.gloveRCurrent.y,A.y,22,n),this.gloveRCurrent.z=Qv(this.gloveRCurrent.z,A.z,22,n),this.solveArmIK(o.shoulderL,o.elbowL,o.gloveL,this.gloveLCurrent,1,o),this.solveArmIK(o.shoulderR,o.elbowR,o.gloveR,this.gloveRCurrent,-1,o),this.applyTrauma(e,t,a)}poseLegs(e,t,n,r,i){let a=this.rig,o=Math.min(.5,t*.35)*(1-n),s=Math.sin(this.walkPhase)*o,c=-this.drop*1.4*(1-n),l={hip:-.18-c*.5,knee:.26+c,ankle:-.08-c*.5},u={hip:.14-c*.5,knee:.3+c,ankle:-.1-c*.5};a.hipL.rotation.set(Bl.lerp(l.hip+s,-.5,n),.3*i*(1-n),Bl.lerp(0,.5*r,n)),a.kneeL.rotation.x=Bl.lerp(l.knee-s*.8,.7,n),a.ankleL.rotation.x=Bl.lerp(l.ankle,.4,n),a.hipR.rotation.set(Bl.lerp(u.hip-s,-.35,n),-.12*i*(1-n),Bl.lerp(0,.35*r,n)),a.kneeR.rotation.x=Bl.lerp(u.knee+s*.8,.5,n),a.ankleR.rotation.x=Bl.lerp(u.ankle,.4,n)}solveArmIK(e,t,n,r,i,a){e.getWorldPosition(ny),ay.copy(r),a.chest.localToWorld(ay),ry.set(.9*i,-1,-.25).applyQuaternion(a.chest.getWorldQuaternion(dy)),Fv(ny,ay,ry,iy),zv(e,ny,iy.elbowWorld),e.updateMatrixWorld(!0),zv(t,iy.elbowWorld,iy.targetWorld)}applyTrauma(e,t,n){let r=e.trauma,i=e=>Math.min(.85,e/170+r.swelling/420),a=fy[n];this.rig.bruiseL.material.opacity=i(r.left_eye),this.rig.bruiseR.material.opacity=i(r.right_eye),this.rig.cutL.material.opacity=Math.min(1,r.left_cut/200+r.bleeding/600)*a,this.rig.cutR.material.opacity=Math.min(1,r.right_cut/200+r.bleeding/600)*a;let o=e=>Math.min(1.35,e/260+r.swelling/560),s=o(r.left_eye),c=o(r.right_eye);this.rig.swellL.scale.setScalar(.25+s*1.15),this.rig.swellR.scale.setScalar(.25+c*1.15),this.rig.swellL.material.opacity=Math.min(.92,s*1.1),this.rig.swellR.material.opacity=Math.min(.92,c*1.1);let l=Math.min(1,r.head/900+r.swelling/800);this.rig.cheekL.scale.setScalar(.2+l*1.05),this.rig.cheekR.scale.setScalar(.2+l*.95),this.rig.cheekL.material.opacity=l*.8,this.rig.cheekR.material.opacity=l*.75;let u=Math.min(1.7,(r.left_cut+r.bleeding)/260),d=Math.min(1.7,(r.right_cut+r.bleeding)/260);this.rig.streakL.scale.set(1,.15+u,1),this.rig.streakR.scale.set(1,.15+d,1),this.rig.streakL.material.opacity=Math.min(1,u)*a,this.rig.streakR.material.opacity=Math.min(1,d)*a;let f=Math.min(1.4,r.head/700+r.bleeding/420);this.rig.noseStreak.scale.set(1,.2+f,1),this.rig.noseStreak.material.opacity=Math.min(1,f*.9)*a,this.rig.mouthBlood.material.opacity=Math.min(1,r.head/800+r.bleeding/500)*a;let p=Math.min(1,r.body/750);this.rig.ribL.scale.set(.5+p*.35,1.2+p*.5,.7+p*.2),this.rig.ribR.scale.set(.5+p*.3,1.2+p*.4,.7+p*.2),this.rig.ribL.material.opacity=p*.85,this.rig.ribR.material.opacity=p*.8;let m=Math.min(1,(t.trauma.bleeding+t.trauma.left_cut+t.trauma.right_cut)/620)*a;this.rig.gloveLMaterial.color.copy(this.rig.gloveBaseColor).lerp(py,m*.72),this.rig.bodyBruise.material.opacity=Math.min(.7,r.body/950);let h=1+Math.min(.12,r.swelling/2500);this.rig.headMesh.scale.set(.92*h,1.08*h,.98*h)}},hy=[2765120,3813162,2503738,4206894,3029548,3683390,4471856,5919048,3227722,4863298],gy=[13081462,9067067,7225640,14726287,5517341,11105359],_y=e=>()=>(e=Math.imul(e^e>>>15,1|e),e^=e+Math.imul(e^e>>>7,61|e),((e^e>>>14)>>>0)/4294967296);function vy(){let e=new zu;e.name=`arena`;let t=[],n=[],r=[],i=new Rp({color:`#05070c`,roughness:.95});n.push(i);let a=new Jf(30,40);t.push(a);let o=new pf(a,i);o.rotation.x=-Math.PI/2,o.position.y=-1,o.receiveShadow=!0,e.add(o);let s=_y(20260727),c=[{radius:8.2,y:-.55,count:120,scale:1},{radius:10.6,y:.35,count:150,scale:1.04},{radius:13.2,y:1.35,count:180,scale:1.08},{radius:16,y:2.45,count:210,scale:1.12}],l=c.reduce((e,t)=>e+t.count,0),u=new qf(.19,.5,4,8),d=new Ep(.115,8,7);t.push(u,d);let f=new Rp({roughness:.9,metalness:0}),p=new Rp({roughness:.75,metalness:0});n.push(f,p);let m=new Tf(u,f,l),h=new Tf(d,p,l);m.instanceMatrix.setUsage(el),h.instanceMatrix.setUsage(el);let g=new du,_=new Ku,v=new Float32Array(l),y=[],b=0;for(let e of c)for(let t=0;t<e.count;t+=1){let n=t/e.count*Math.PI*2+s()*.03,r=(s()-.5)*.7,i=Math.sin(n)*(e.radius+r),a=Math.cos(n)*(e.radius+r),o=e.y+(s()-.5)*.12,c=Math.atan2(-i,-a)+(s()-.5)*.5,l=e.scale*(.92+s()*.2);y.push({x:i,y:o,z:a,yaw:c,scale:l}),v[b]=s()*Math.PI*2,g.compose(new Q(i,o+.45*l,a),new Vl().setFromAxisAngle(new Q(0,1,0),c),new Q(l,l,l)),m.setMatrixAt(b,g),g.compose(new Q(i,o+.95*l,a),new Vl,new Q(l,l,l)),h.setMatrixAt(b,g),_.setHex(hy[Math.floor(s()*hy.length)]).multiplyScalar(.85+s()*.6),m.setColorAt(b,_),_.setHex(gy[Math.floor(s()*gy.length)]).multiplyScalar(.85+s()*.35),h.setColorAt(b,_),b+=1}m.instanceColor.needsUpdate=!0,h.instanceColor.needsUpdate=!0,e.add(m,h);let x=new Float32Array(270);for(let e=0;e<90;e+=1){let t=c[Math.floor(s()*c.length)],n=s()*Math.PI*2;x[e*3]=Math.sin(n)*t.radius,x[e*3+1]=t.y+.9+s()*.5,x[e*3+2]=Math.cos(n)*t.radius}let S=new Ud;S.setAttribute(`position`,new Od(x,3)),t.push(S);let C=new Pf({color:13623551,size:.09,transparent:!0,opacity:0,blending:2,depthWrite:!1});n.push(C);let w=new zf(S,C);e.add(w);let T=new Rp({color:`#11151d`,roughness:.6,metalness:.4});n.push(T);let E=new Rp({color:`#1a2230`,emissive:`#dfe9ff`,emissiveIntensity:1.1,roughness:.4});n.push(E);let D=new ef({color:`#a8c4ff`,transparent:!0,opacity:.014,blending:2,depthWrite:!1,side:2});n.push(D);let O=new Kf(9,.18,.18);t.push(O);let ee=new Yf(.09,.14,.22,10);t.push(ee);let k=new Xf(1.7,6.6,20,1,!0);t.push(k);for(let t=0;t<2;t+=1){let n=new pf(O,T);n.position.set(0,7.6,t===0?-1.6:1.6),e.add(n);for(let t=0;t<5;t+=1){let r=-3.6+t*1.8,i=new pf(ee,E);i.position.set(r,7.45,n.position.z),e.add(i);let a=new pf(k,D);a.position.set(r,4.1,n.position.z*.4),e.add(a)}}let te=new Rp({color:`#070a12`,roughness:1});n.push(te);let ne=new Yf(24,24,14,32,1,!0);t.push(ne);let A=new pf(ne,te);A.position.y=5,A.material.side=1,e.add(A);let re=document.createElement(`canvas`);re.width=512,re.height=256;let ie=re.getContext(`2d`);ie!==null&&(ie.fillStyle=`#04060c`,ie.fillRect(0,0,512,256),ie.strokeStyle=`#f1cc72`,ie.lineWidth=6,ie.strokeRect(14,14,484,228),ie.fillStyle=`#f1cc72`,ie.font=`800 84px Inter, system-ui, sans-serif`,ie.textAlign=`center`,ie.textBaseline=`middle`,ie.fillText(`H A N D S`,256,104),ie.fillStyle=`#8fa3c8`,ie.font=`600 30px Inter, system-ui, sans-serif`,ie.fillText(`CHAMPIONSHIP BOXING`,256,186));let ae=new Hf(re);ae.colorSpace=Jc;let oe=new ef({map:ae});n.push(oe);let j=new Kf(4.6,2.3,.3);t.push(j);let se=new pf(j,oe);se.position.set(0,6.4,-14.5),e.add(se);let ce=new pf(j,T);ce.position.set(0,6.4,-14.65),e.add(ce),r.push(ae);let le=0,M=0,ue=new du,de=new Q,fe=new Vl,pe=new Q,me=new Q(0,1,0);return{group:e,update:(e,t,n)=>{if(!n){let n=Math.floor(e*30%l);for(let t=0;t<90;t+=1){let r=(n+t)%l,i=y[r],a=Math.sin(e*1.6+v[r])*.05,o=Math.abs(Math.sin(e*2.3+v[r]*1.7))*.05;fe.setFromAxisAngle(me,i.yaw+a),ue.compose(de.set(i.x,i.y+.45*i.scale+o,i.z+a*.4),fe,pe.set(i.scale,i.scale,i.scale)),m.setMatrixAt(r,ue),fe.setFromAxisAngle(me,i.yaw+a*1.2),ue.compose(de.set(i.x,i.y+.95*i.scale+o*1.2,i.z+a*.5),fe,pe),h.setMatrixAt(r,ue)}m.instanceMatrix.needsUpdate=!0,h.instanceMatrix.needsUpdate=!0,le-=t,le<=0&&(M=.09+Math.random()*.08,le=.25+Math.random()*1.6),M=Math.max(0,M-t),C.opacity=M>0?.85:0}},dispose:()=>{for(let e of t)e.dispose();for(let e of n)e.dispose();for(let e of r)e.dispose();m.dispose(),h.dispose()}}}var yy=1.88,by=7.15,xy=1.12,Sy=class{current=new Q(0,yy,by);look=new Q(0,xy,0);swayPhase=0;update(e,t,n,r,i,a,o,s){this.swayPhase+=e;let c=(n.x+r.x)/2,l=(n.z+r.z)/2,u=Bl.clamp(c,-1.4,1.4),d=Bl.clamp(l,-1.1,1.1),f=Bl.clamp(by+i*.42-(a?1.1:0),6.4,9.8),p=yy+i*.1-(a?.35:0),m=s?0:Math.sin(this.swayPhase*.21)*.35,h=s?0:Math.sin(this.swayPhase*.13)*.3,g=u*.32+m,_=f+d*.2,v=p+h*.2;if(this.current.x+=(g-this.current.x)*(1-Math.exp(-2.6*e)),this.current.y+=(v-this.current.y)*(1-Math.exp(-2.6*e)),this.current.z+=(_-this.current.z)*(1-Math.exp(-2.6*e)),this.look.x+=(u-this.look.x)*(1-Math.exp(-3.2*e)),this.look.y+=((a?.75:xy)-this.look.y)*(1-Math.exp(-3.2*e)),this.look.z+=(d*.6-this.look.z)*(1-Math.exp(-3.2*e)),!s&&o>5e-4){let e=t*61;this.current.x+=Math.sin(e*1.31)*o,this.current.y+=Math.cos(e*1.97)*o*.6,this.look.x+=Math.sin(e*1.53)*o*.5,this.look.y+=Math.cos(e*2.11)*o*.35}return{position:this.current,lookAt:this.look}}},Cy=3.05,wy=3.85,Ty=4.05,Ey=3.42,Dy=[.5,.88,1.26];function Oy(e){let t=Cy/Math.max(1,e.ring_half_width),n=Cy/Math.max(1,e.ring_half_height);return{x:e=>e*t,z:e=>-e*n}}var ky={blue:1920728,red:12131356,neutral:15067115},Ay=[{skin:11563071,skinShadow:9065520,trunks:1327211,trunkTrim:14267484,glove:1920728,gloveTrim:15067115,hair:1643537,shoe:2240573},{skin:7225640,skinShadow:5582877,trunks:7017504,trunkTrim:15067115,glove:12131356,gloveTrim:14267484,hair:854794,shoe:2956316}],jy=900,My=90,Ny=48,Py=e=>()=>(e=Math.imul(e^e>>>15,1|e),e^=e+Math.imul(e^e>>>7,61|e),((e^e>>>14)>>>0)/4294967296),Fy=new Set([`hit`,`counter_hit`,`block`,`knockdown`,`bleed`]);function Iy(){let e=document.createElement(`canvas`);e.width=64,e.height=64;let t=e.getContext(`2d`);if(t!==null){let e=t.createRadialGradient(32,32,2,32,32,30);e.addColorStop(0,`rgba(120,10,16,0.55)`),e.addColorStop(.5,`rgba(90,8,14,0.28)`),e.addColorStop(1,`rgba(70,6,10,0)`),t.fillStyle=e,t.fillRect(0,0,64,64)}return new Hf(e)}var Ly=class{scene;points;droplets=[];dropletPositions;dropletColors;dropletGeometry;dropletMaterial;mistPoints;mists=[];mistPositions;mistColors;mistGeometry;mistMaterial;mistMap;decals=[];decalGeometry;decalIndex=0;dripAccumulator=0;shake=0;bloodLevel=`full`;constructor(e){this.scene=e,this.dropletPositions=new Float32Array(jy*3),this.dropletColors=new Float32Array(jy*3),this.dropletGeometry=new Ud,this.dropletGeometry.setAttribute(`position`,new Od(this.dropletPositions,3)),this.dropletGeometry.setAttribute(`color`,new Od(this.dropletColors,3)),this.dropletMaterial=new Pf({size:.032,vertexColors:!0,transparent:!0,opacity:.92,depthWrite:!1,sizeAttenuation:!0}),this.points=new zf(this.dropletGeometry,this.dropletMaterial),this.points.frustumCulled=!1,e.add(this.points);for(let e=0;e<jy;e+=1)this.droplets.push({alive:!1,x:0,y:-50,z:0,vx:0,vy:0,vz:0,life:0,maxLife:1,r:1,g:1,b:1});this.mistPositions=new Float32Array(My*3),this.mistColors=new Float32Array(My*3),this.mistGeometry=new Ud,this.mistGeometry.setAttribute(`position`,new Od(this.mistPositions,3)),this.mistGeometry.setAttribute(`color`,new Od(this.mistColors,3)),this.mistMap=Iy(),this.mistMaterial=new Pf({size:.34,map:this.mistMap,transparent:!0,opacity:.55,depthWrite:!1,sizeAttenuation:!0}),this.mistPoints=new zf(this.mistGeometry,this.mistMaterial),this.mistPoints.frustumCulled=!1,e.add(this.mistPoints);for(let e=0;e<My;e+=1)this.mists.push({alive:!1,x:0,y:-50,z:0,life:0,maxLife:1,scale:1});this.decalGeometry=new Jf(.09,12);for(let t=0;t<Ny;t+=1){let n=new pf(this.decalGeometry,new ef({color:7212307,transparent:!0,opacity:.42,depthWrite:!1}));n.rotation.x=-Math.PI/2,n.position.y=.004+t*15e-5,n.visible=!1,this.decals.push(n),e.add(n)}}setBloodLevel(e){e!==this.bloodLevel&&(this.bloodLevel=e,e===`off`&&this.clearDecals())}get shakeAmount(){return this.shake}get liveParticles(){return this.droplets.filter(e=>e.alive).length}get liveMist(){return this.mists.filter(e=>e.alive).length}get visibleDecals(){return this.decals.filter(e=>e.visible).length}bloodScale(){return this.bloodLevel===`off`?0:this.bloodLevel===`reduced`?.35:1}spawnDroplet(e,t,n,r,i,a,o,s,c){let l=this.droplets.find(e=>!e.alive);l!==void 0&&(l.alive=!0,l.x=t,l.y=n,l.z=r,l.vx=i,l.vy=a,l.vz=o,l.maxLife=c,l.life=c,l.r=s.r,l.g=s.g,l.b=s.b)}spawnMist(e,t,n,r,i){let a=this.mists.find(e=>!e.alive);a!==void 0&&(a.alive=!0,a.x=e,a.y=t,a.z=n,a.maxLife=i,a.life=i,a.scale=r)}placeDecal(e,t,n,r,i,a,o){let s=this.decals[this.decalIndex%Ny];this.decalIndex+=1,s.visible=!0,s.position.x=e,s.position.z=t,s.rotation.z=i,s.scale.set(n,r,1);let c=s.material;c.opacity=a,c.color.setHex(o)}splatter(e,t,n,r=Math.random){let i=this.bloodScale();if(i===0)return;let a=Math.round(4*i)+2;for(let o=0;o<a;o+=1){let a=r()*Math.PI*2,s=r()*.32*n;this.placeDecal(e+Math.sin(a)*s,t+Math.cos(a)*s,(.35+r()*.8)*n*i,(.2+r()*.5)*n*i,r()*Math.PI,(.32+r()*.2)*i,o===0?5900558:7212307)}}pool(e,t,n){let r=this.bloodScale();r!==0&&this.placeDecal(e,t,2.6*n*r,1.9*n*r,Math.random()*Math.PI,.5*r,4982539)}addEvent(e,t,n){if(!Fy.has(e.kind))return;let r=Py(e.event_id*7919+17),i=e.kind===`block`,a={x:t.x,y:1.58,z:t.z},o=this.bloodScale(),s=n?0:Math.round((i?6:14)+Math.min(18,e.amount/22)),c=n?0:Math.round(Math.min(46,e.blood/3.2)*o);this.shake=Math.min(.09,this.shake+(i?.008:Math.max(.012,e.amount/2600))),e.kind===`knockdown`&&(this.shake=Math.min(.14,this.shake+.06));for(let t=0;t<s;t+=1){let t=r()*Math.PI*2,n=.4+r()*.9;this.spawnDroplet(r,a.x+(r()-.5)*.12,a.y+(r()-.5)*.14,a.z+(r()-.5)*.12,Math.sin(t)*n+e.direction*(.5+r()*.9),.6+r()*1.5,Math.cos(t)*n,{r:.82,g:.9,b:1},.5+r()*.5)}for(let t=0;t<c;t+=1){let n=t%4==0,i=n?.16:.55,o=(r()-.5)*Math.PI*i,s=n?1.9+r()*1.4:.7+r()*1.1,c=r();this.spawnDroplet(r,a.x+(r()-.5)*.1,a.y+(r()-.5)*.12,a.z+(r()-.5)*.1,e.direction*s*Math.cos(o)+(r()-.5)*.3,n?1.1+r()*1.2:.4+r()*1,e.direction*s*Math.sin(o)+(r()-.5)*.3,c<.3?{r:.62,g:.05,b:.08}:c<.7?{r:.42,g:.03,b:.05}:{r:.28,g:.02,b:.04},.55+r()*.65)}if(!n&&o>0&&(e.amount>190||e.kind===`knockdown`||e.kind===`counter_hit`)){let t=e.kind===`knockdown`?5:3;for(let e=0;e<t;e+=1)this.spawnMist(a.x+(r()-.5)*.2,a.y+(r()-.5)*.16,a.z+(r()-.5)*.2,(.7+r()*.9)*o,.5+r()*.4)}e.blood>8&&o>0&&this.splatter(a.x+(r()-.5)*.5,a.z+(r()-.5)*.5,.7+Math.min(1.4,e.blood/90)*o,r)}drip(e,t,n,r){let i=this.bloodScale();if(!(i===0||r||t<=.05))for(this.dripAccumulator+=n*Math.min(7,t*6)*i;this.dripAccumulator>=1;)--this.dripAccumulator,this.spawnDroplet(Math.random,e.x+(Math.random()-.5)*.14,e.y-.04,e.z+(Math.random()-.5)*.1,(Math.random()-.5)*.05,-.25-Math.random()*.3,(Math.random()-.5)*.05,{r:.5,g:.04,b:.06},1.1)}update(e){this.shake*=.02**e;let t=!1;for(let[n,r]of this.droplets.entries()){if(!r.alive){this.dropletPositions[n*3+1]=-50;continue}if(t=!0,r.life-=e,r.life<=0||r.y<0){r.y<0&&r.r<.85&&this.bloodScale()>0&&Math.random()<.3&&this.placeDecal(r.x,r.z,.22+Math.random()*.3,.14+Math.random()*.2,Math.random()*Math.PI,.34*this.bloodScale(),7212307),r.alive=!1,this.dropletPositions[n*3+1]=-50;continue}r.vy-=4.6*e,r.x+=r.vx*e,r.y+=r.vy*e,r.z+=r.vz*e;let i=Math.min(1,r.life/(r.maxLife*.4));this.dropletPositions[n*3]=r.x,this.dropletPositions[n*3+1]=r.y,this.dropletPositions[n*3+2]=r.z,this.dropletColors[n*3]=r.r*i,this.dropletColors[n*3+1]=r.g*i,this.dropletColors[n*3+2]=r.b*i}t&&(this.dropletGeometry.attributes.position.needsUpdate=!0,this.dropletGeometry.attributes.color.needsUpdate=!0);let n=!1;for(let[t,r]of this.mists.entries()){if(!r.alive){this.mistPositions[t*3+1]=-50;continue}if(n=!0,r.life-=e,r.life<=0){r.alive=!1,this.mistPositions[t*3+1]=-50;continue}let i=1-r.life/r.maxLife,a=Math.max(0,1-i)*.6;this.mistPositions[t*3]=r.x,this.mistPositions[t*3+1]=r.y+i*.12,this.mistPositions[t*3+2]=r.z,this.mistColors[t*3]=a,this.mistColors[t*3+1]=a*.12,this.mistColors[t*3+2]=a*.14}n&&(this.mistGeometry.attributes.position.needsUpdate=!0,this.mistGeometry.attributes.color.needsUpdate=!0)}clearDynamic(){for(let e of this.droplets)e.alive=!1;for(let e of this.mists)e.alive=!1;this.shake=0,this.dripAccumulator=0}clearDecals(){for(let e of this.decals)e.visible=!1}dispose(){this.scene.remove(this.points),this.scene.remove(this.mistPoints),this.dropletGeometry.dispose(),this.dropletMaterial.dispose(),this.mistGeometry.dispose(),this.mistMaterial.dispose(),this.mistMap.dispose(),this.decalGeometry.dispose();for(let e of this.decals)this.scene.remove(e),e.material.dispose()}},Ry=1e3,zy=e=>e.reduce((e,t)=>e+t,0),By=(e,t,n)=>{if(e.measureText(t).width<=n)return t;let r=t;for(;r.length>1&&e.measureText(`${r}…`).width>n;)r=r.slice(0,-1);return`${r}…`};function Vy(e,t,n,r,i,a){e.fillStyle=`rgba(2,4,9,0.85)`,e.fillRect(t-1,n-1,r+2,11);let o=e.createLinearGradient(0,n,0,n+9);o.addColorStop(0,`rgba(210,220,235,0.5)`),o.addColorStop(.5,`rgba(90,100,120,0.25)`),o.addColorStop(1,`rgba(30,36,50,0.4)`),e.strokeStyle=o,e.lineWidth=1,e.strokeRect(t-1.5,n-1.5,r+3,12);let s=Math.max(0,Math.min(1,i.value/Math.max(1,i.maximum))),c=e.createLinearGradient(0,n,0,n+9);c.addColorStop(0,i.from),c.addColorStop(1,i.to),e.fillStyle=c;let l=r*s;e.fillRect(a?t+r-l:t,n,l,9),e.fillStyle=`rgba(255,255,255,0.22)`,e.fillRect(a?t+r-l:t,n,l,2),e.fillStyle=`#dfe7f5`,e.font=`700 9px Inter, system-ui, sans-serif`,e.textAlign=a?`right`:`left`,e.fillText(i.label,a?t+r:t,n-4)}function Hy(e,t,n,r,i,a,o,s,c){e.save(),e.beginPath(),s?(e.moveTo(t+14,n),e.lineTo(t+r,n),e.lineTo(t+r-14,n+62),e.lineTo(t,n+62)):(e.moveTo(t,n),e.lineTo(t+r-14,n),e.lineTo(t+r,n+62),e.lineTo(t+14,n+62)),e.closePath(),e.fillStyle=`rgba(3,6,12,0.82)`,e.fill(),e.strokeStyle=`rgba(190,200,220,0.22)`,e.lineWidth=1,e.stroke(),e.fillStyle=c,e.fillRect(s?t+r-5:t,n+4,5,54);let l=s?t+r-20:t+20;e.textAlign=s?`right`:`left`,e.fillStyle=`#f5f8ff`,e.font=`800 16px Inter, system-ui, sans-serif`,e.fillText(By(e,i.toUpperCase(),r-44),l,n+21),e.fillStyle=`#93a3bd`,e.font=`600 10px Inter, system-ui, sans-serif`,e.fillText(a,l,n+35);let u=(r-52)/o.length,d=o.length*u+(o.length-1)*12,f=s?t+r-20-d:t+20;o.forEach((t,r)=>{Vy(e,f+(u+12)*r,n+48,u,t,s)}),e.restore()}function Uy(e,t,n,r,i,a){e.save(),e.beginPath(),e.moveTo(t-168/2+12,n),e.lineTo(t+168/2-12,n),e.lineTo(t+168/2,n+58/2),e.lineTo(t+168/2-12,n+58),e.lineTo(t-168/2+12,n+58),e.lineTo(t-168/2,n+58/2),e.closePath(),e.fillStyle=`rgba(4,6,12,0.88)`,e.fill();let o=e.createLinearGradient(t-168/2,n,t+168/2,n+58);o.addColorStop(0,`#8a6a26`),o.addColorStop(.5,`#f6d57a`),o.addColorStop(1,`#8a6a26`),e.strokeStyle=o,e.lineWidth=2,e.stroke(),e.textAlign=`center`,e.fillStyle=`#ffffff`,e.font=`800 22px ui-monospace, monospace`,e.fillText(r,t,n+27),e.fillStyle=`#f6d57a`,e.font=`800 12px Inter, system-ui, sans-serif`,e.fillText(i,t,n+44),a!==`FIGHT`&&(e.fillStyle=`#93a3bd`,e.font=`700 9px Inter, system-ui, sans-serif`,e.fillText(a,t,n+55)),e.restore()}function Wy(e,t,n,r,i,a=0){let o=t/2-320/2,s=n/2-78/2+a;e.fillStyle=`rgba(3,6,12,0.88)`,e.fillRect(o,s,320,78),e.strokeStyle=`rgba(246,213,122,0.45)`,e.lineWidth=1.5,e.strokeRect(o+2,s+2,316,74),e.textAlign=`center`,e.fillStyle=`#ffd77a`,e.font=`800 22px Inter, system-ui, sans-serif`,e.fillText(r,t/2,s+34),e.fillStyle=`#c8d3e6`,e.font=`600 12px Inter, system-ui, sans-serif`,e.fillText(i,t/2,s+58)}function Gy(e,t,n,r,i,a,o,s,c=30){e.save(),e.textBaseline=`alphabetic`;let l=Math.min(300,t*.38),u=n-84;r.fighters.forEach((n,r)=>{let a=r===1,o=a?t-24-l:24,s=i[n.player_id],c=`ELO ${s?.rating??`—`} · KD ${n.knockdowns} · W ${n.warnings} · −${n.deductions}`,d=[{label:`STAMINA ${Math.round(n.stamina)}`,value:n.stamina,maximum:n.maximum_stamina,from:`#ffe08a`,to:`#d9a53a`},{label:`HEALTH ${Math.round(n.conditioning)}`,value:n.conditioning,maximum:Ry,from:`#ff8a7a`,to:`#b02a20`},{label:`GUARD`,value:n.guard,maximum:700,from:`#9ec7ff`,to:`#3d6fb8`},{label:`POISE ${Math.round(n.poise)}`,value:n.poise,maximum:600,from:`#e8c890`,to:`#8a6a34`}];Hy(e,o,u,l,s?.name??`Fighter`,c,d.slice(0,2),a,r===0?`#3d6fb8`:`#b02a20`);let f=u-12;Vy(e,a?o+l-148:o+20,f,64,d[2],a),Vy(e,a?o+l-72:o+96,f,64,d[3],a)});let d=Math.floor(r.phase_ticks_remaining/c),f=`${Math.floor(d/60)}:${String(d%60).padStart(2,`0`)}`;if(Uy(e,t/2,n-84,f,`ROUND ${r.round_number}`,r.phase.replace(`_`,` `).toUpperCase()),r.phase===`knockdown`){let i=r.fighters.find(e=>e.player_id===a),o=Math.max(...r.fighters.map(e=>e.get_up_count)),s=i?.get_up_prompt!==null&&i?.get_up_prompt!==void 0?`YOUR RHYTHM: ${i.get_up_prompt===`get_up_left`?`←`:`→`}  ${i.get_up_meter}/${i.get_up_required}`:`Waiting for the count`;Wy(e,t,n,`COUNT ${o}`,s,-n*.18)}r.phase===`foul_recovery`&&Wy(e,t,n,`FOUL RECOVERY`,`${i[r.fighters.find(e=>e.is_foul_recovery_target)?.player_id??``]?.name??`Fighter`} is recovering`),r.phase===`rest`&&Wy(e,t,n,`CORNERS · RECOVER`,`Conditioning governs recovery`),s>0&&Wy(e,t,n,`OPPONENT RECONNECTING · ${Math.ceil(s/1e3)}s`,`The bout is paused`),o!==null&&Ky(e,t,n,o,i),e.restore()}function Ky(e,t,n,r,i){e.fillStyle=`rgba(2,4,9,0.94)`,e.fillRect(t*.14,n*.13,t*.72,n*.74),e.strokeStyle=`rgba(246,213,122,0.5)`,e.lineWidth=2,e.strokeRect(t*.14+4,n*.13+4,t*.72-8,n*.74-8),e.textAlign=`center`,e.fillStyle=`#f6d57a`,e.font=`800 26px Inter, system-ui, sans-serif`,e.fillText(r.method.replaceAll(`_`,` `).toUpperCase(),t/2,n*.21);let a=r.winner_id===null?`DRAW`:`${i[r.winner_id]?.name??`Winner`} WINS`;e.fillStyle=`white`,e.font=`700 18px Inter, system-ui, sans-serif`,e.fillText(By(e,a,t*.6),t/2,n*.27),e.font=`12px ui-monospace, monospace`,r.scorecards.forEach((r,i)=>{let a=n*.37+i*36;e.fillStyle=`#aebbd0`,e.fillText(`${By(e,r.judge,100)}  ${zy(r.player_one)} — ${zy(r.player_two)}  [${r.player_one.join(`·`)}] [${r.player_two.join(`·`)}]`,t/2,a)});let o=Object.entries(r.ratings);e.font=`600 13px Inter, system-ui, sans-serif`,o.forEach(([r,a],o)=>{e.fillStyle=a.after>=a.before?`#55df9b`:`#ff7b74`,e.fillText(`${By(e,i[r]?.name??`Fighter`,100)}  ${a.before} → ${a.after} (${a.after-a.before>=0?`+`:``}${a.after-a.before})`,t/2,n*.61+o*27)})}function qy(e,t){let n=document.createElement(`canvas`);n.width=e,n.height=e;let r=n.getContext(`2d`);r!==null&&t(r,e);let i=new Hf(n);return i.anisotropy=8,i.colorSpace=Jc,i}function Jy(){return qy(1024,(e,t)=>{e.fillStyle=`#2c4386`,e.fillRect(0,0,t,t);let n=e.createLinearGradient(0,0,t,t);n.addColorStop(0,`rgba(255,255,255,0.05)`),n.addColorStop(.5,`rgba(0,0,0,0.04)`),n.addColorStop(1,`rgba(255,255,255,0.03)`),e.fillStyle=n,e.fillRect(0,0,t,t);for(let n=0;n<900;n+=1){let r=Math.sin(n*12.9898)*43758.5453%1,i=Math.sin(n*78.233)*12543.1234%1;e.fillStyle=`rgba(${n%2==0?`255,255,255`:`10,20,50`},${.015+n%5*.004})`,e.fillRect(Math.abs(r)*t,Math.abs(i)*t,2+n%3,1+n%2)}e.strokeStyle=`rgba(235,240,255,0.9)`,e.lineWidth=10,e.beginPath(),e.arc(t/2,t/2,t*.2,0,Math.PI*2),e.stroke(),e.fillStyle=`rgba(235,240,255,0.92)`,e.font=`800 ${Math.round(t*.062)}px Inter, system-ui, sans-serif`,e.textAlign=`center`,e.textBaseline=`middle`,e.fillText(`H A N D S`,t/2,t/2-t*.012),e.font=`600 ${Math.round(t*.024)}px Inter, system-ui, sans-serif`,e.fillText(`AUTHORITATIVE BOXING`,t/2,t/2+t*.052),e.strokeStyle=`rgba(235,240,255,0.55)`,e.lineWidth=5,e.strokeRect(t*.035,t*.035,t*.93,t*.93)})}function Yy(){let e=[],t=[],n=[],r=new zu;r.name=`ring`;let i=Jy();n.push(i);let a=new Rp({map:i,roughness:.92,metalness:0});t.push(a);let o=new wp(Cy*2,Cy*2);e.push(o);let s=new pf(o,a);s.rotation.x=-Math.PI/2,s.position.y=.002,s.receiveShadow=!0,r.add(s);let c=new Rp({color:`#16233f`,roughness:.85});t.push(c);let l=new Tp(Cy*.98,wy,4,1);e.push(l);let u=new pf(l,c);u.rotation.x=-Math.PI/2,u.rotation.z=Math.PI/4,u.position.y=.001,u.receiveShadow=!0,r.add(u);let d=new Rp({color:`#0c1424`,roughness:.9});t.push(d);let f=new Kf(Ty*2,1,Ty*2);e.push(f);let p=new pf(f,d);p.position.y=-.5,p.receiveShadow=!0,r.add(p);let m=new Rp({color:`#101b33`,roughness:.95});t.push(m);for(let t=0;t<4;t+=1){let n=new wp(Ty*2,.95);e.push(n);let i=new pf(n,m),a=t*Math.PI/2;i.position.set(Math.sin(a)*(Ty-.001),-.48,Math.cos(a)*(Ty-.001)),i.rotation.y=a,r.add(i)}let h=new Rp({color:`#9aa7b5`,roughness:.35,metalness:.75});t.push(h);let g=[ky.blue,ky.neutral,ky.red,ky.neutral],_=new Yf(.055,.055,1.55,12);e.push(_);let v=new Kf(.34,.52,.13);e.push(v);let y=new Kf(.16,.07,.1);e.push(y);let b=[];for(let e=0;e<4;e+=1){let n=Math.PI/4+e*Math.PI/2,i=Math.sin(n)*Ey*Math.SQRT2*.72,a=Math.cos(n)*Ey*Math.SQRT2*.72;b.push(new Q(i,0,a));let o=new pf(_,h);o.position.set(i,.78,a),o.castShadow=!0,r.add(o);let s=new Rp({color:g[e],roughness:.55});t.push(s);for(let e of[.62,1.12]){let t=new pf(v,s);t.position.set(i*.985,e,a*.985),t.lookAt(0,e,0),t.castShadow=!0,r.add(t)}}let x=[12131356,15067115,1920728].map(e=>{let n=new Rp({color:e,roughness:.42,metalness:.05});return t.push(n),n});for(let n=0;n<4;n+=1){let i=b[n],a=b[(n+1)%4];for(let[n,o]of Dy.entries()){let s=i.clone().add(a).multiplyScalar(.5);s.y=o-.045;let c=new Sp(new Q(i.x,o,i.z),s,new Q(a.x,o,a.z)),l=new Dp(c,24,.028,8,!1);e.push(l);let u=new pf(l,x[n]);u.castShadow=!0,r.add(u);for(let n of[.33,.66]){let i=c.getPoint(n),a=new Kf(.035,.82,.012);e.push(a);let s=new Rp({color:14212840,roughness:.6});t.push(s);let l=new pf(a,s);l.position.set(i.x,o-.36,i.z),l.lookAt(0,o-.36,0),r.add(l)}}}return{group:r,materials:t,geometries:e,textures:n}}function Xy(e){for(let t of e.geometries)t.dispose();for(let t of e.materials)t.dispose();for(let t of e.textures)t.dispose()}function Zy(e,t=2){let n=e.getBoundingClientRect(),r=Math.max(1,Math.round(n.width)),i=Math.max(1,Math.round(n.height)),a=Math.min(t,Math.max(1,window.devicePixelRatio||1));(e.width!==Math.round(r*a)||e.height!==Math.round(i*a))&&(e.width=Math.round(r*a),e.height=Math.round(i*a));let o=e.getContext(`2d`);return o===null?null:(o.setTransform(a,0,0,a,0,0),{context:o,viewport:{width:r,height:i},dpr:a})}function Qy(){let e=document.createElement(`canvas`);e.width=128,e.height=128;let t=e.getContext(`2d`);if(t!==null){let e=t.createRadialGradient(64,64,8,64,64,62);e.addColorStop(0,`rgba(0,0,0,0.68)`),e.addColorStop(.6,`rgba(0,0,0,0.34)`),e.addColorStop(1,`rgba(0,0,0,0)`),t.fillStyle=e,t.fillRect(0,0,128,128)}return new Hf(e)}var $y={tick_rate:30,ring_half_width:500,ring_half_height:330},eb=class{canvas;simulation;settings;renderer;scene=new Yu;camera;composer;ring;arena;boxers;referee;refereePosition=new Q(.4,0,-2.1);animators;effects;director=new Sy;mapping;buffer=new bs;dedupe=new xs;hudCanvas;blobShadows=[];blobTexture;lights=[];keyLight=null;sizeCheck=new Z;refereeAway=new Q;refereeYaw=0;raf=0;previous=performance.now();players={};viewerId=null;final=null;reconnectMs=0;destroyed=!1;tmpA=new Q;tmpB=new Q;tmpHead=new Q;constructor(e,t=$y,n){this.canvas=e,this.simulation=t,this.settings=n,this.mapping=Oy(t),this.renderer=new ov({canvas:e,antialias:!0,powerPreference:`high-performance`}),this.renderer.shadowMap.enabled=!0,this.renderer.shadowMap.type=1,this.renderer.toneMapping=4,this.renderer.toneMappingExposure=1,this.renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1)),this.scene.background=new Ku(`#04060b`),this.scene.fog=new Ju(`#04060b`,.042),this.camera=new _m(38,1,.1,80),this.camera.position.set(0,2.05,7.6),this.camera.lookAt(0,1.1,0),this.setupLights(),this.ring=Yy(),this.scene.add(this.ring.group),this.arena=vy(),this.scene.add(this.arena.group),this.effects=new Ly(this.scene),this.boxers=[Ev(Ay[0]),Ev(Ay[1])],this.animators=[new my(this.boxers[0],this.mapping),new my(this.boxers[1],this.mapping)],this.boxers[0].root.position.set(-.9,0,0),this.boxers[1].root.position.set(.9,0,0),this.boxers[0].root.rotation.y=Math.PI/2,this.boxers[1].root.rotation.y=-Math.PI/2,this.scene.add(this.boxers[0].root,this.boxers[1].root),this.referee=Bv(),this.referee.root.position.copy(this.refereePosition),this.referee.shoulderL.rotation.x=-.42,this.referee.shoulderR.rotation.x=-.42,this.referee.elbowL.rotation.x=-.55,this.referee.elbowR.rotation.x=-.55,this.scene.add(this.referee.root),this.blobTexture=Qy();let r=new wp(1,1);for(let e=0;e<3;e+=1){let t=new pf(r,new ef({map:this.blobTexture,transparent:!0,depthWrite:!1}));t.rotation.x=-Math.PI/2,t.position.y=.006+e*4e-4,t.renderOrder=1,this.blobShadows.push(t),this.scene.add(t)}this.composer=new hv(this.renderer),this.composer.addPass(new gv(this.scene,this.camera));let i=new vv(new Z(1280,720),.32,.5,.85);this.composer.addPass(i),this.composer.addPass(new bv),this.hudCanvas=document.createElement(`canvas`),this.hudCanvas.className=`fight-hud`,this.hudCanvas.style.cssText=`position:absolute;inset:0;width:100%;height:100%;pointer-events:none`,e.insertAdjacentElement(`afterend`,this.hudCanvas),this.effects.setBloodLevel(n().blood),this.raf=requestAnimationFrame(e=>this.draw(e))}setPlayers(e,t){this.players=e,this.viewerId=t}setFinal(e){this.final=e}setReconnect(e){this.reconnectMs=e}setBloodLevel(e){this.effects.setBloodLevel(e)}setReducedMotion(e){e&&this.effects.clearDynamic()}push(e){if(this.buffer.push(e))for(let t of this.dedupe.accept(e.events)){let n=e.fighters.find(e=>e.player_id===t.target_id)??e.fighters.find(e=>e.player_id===t.actor_id)??e.fighters[0];this.tmpA.set(this.mapping.x(n.x),0,this.mapping.z(n.y)),this.effects.addEvent(t,this.tmpA,this.settings().reducedMotion),t.kind===`knockdown`&&this.effects.pool(this.tmpA.x+(Math.random()-.5)*.2,this.tmpA.z+(Math.random()-.5)*.2,1);let r=e.fighters.findIndex(e=>e.player_id===t.target_id);r>=0&&[`hit`,`counter_hit`,`block`,`knockdown`].includes(t.kind)&&this.animators[r].impact({direction:t.direction,amount:t.kind===`block`?t.amount*.35:t.amount,blocked:t.kind===`block`})}}setupLights(){let e=new am(`#33415e`,`#05060a`,.5);this.scene.add(e),this.lights.push(e);let t=new Cm(`#2b3450`,.55);this.scene.add(t),this.lights.push(t);let n=new ym(`#fff4e0`,115,26,.68,.6,1.6);n.position.set(0,7.4,.9),n.target.position.set(0,0,0),n.castShadow=!0,n.shadow.mapSize.set(2048,2048),n.shadow.bias=-4e-4,n.shadow.camera.near=3,n.shadow.camera.far=14,this.keyLight=n,this.scene.add(n,n.target),this.lights.push(n);for(let[e,t,n,r]of[[`#b9cdff`,-6.5,4.4,-5.2],[`#ffd9b9`,6.2,4.1,-5.6],[`#9fb8ff`,-5.4,3.6,6],[`#c9d8ff`,5.8,3.9,5.7]]){let i=new ym(e,60,30,.7,.8,1.8);i.position.set(t,n,r),i.target.position.set(0,1,0),this.scene.add(i,i.target),this.lights.push(i)}let r=new Sm(`#dfe9ff`,.7);r.position.set(0,3.4,-6.5),this.scene.add(r),this.lights.push(r)}draw(e){if(this.destroyed)return;let t=Math.min(.05,Math.max(.001,(e-this.previous)/1e3));this.previous=e;let n=this.canvas.clientWidth,r=this.canvas.clientHeight;n>0&&r>0&&(this.renderer.getSize(this.sizeCheck),(this.sizeCheck.x!==n||this.sizeCheck.y!==r)&&(this.renderer.setSize(n,r,!1),this.composer.setSize(n,r),this.camera.aspect=n/r,this.camera.updateProjectionMatrix()));let i=e/1e3,a=this.settings();this.effects.setBloodLevel(a.blood);let o=this.buffer.latest(),s=o===null?null:this.buffer.sample(o.tick-1),c=1.8,l=!1;if(s!==null){let[e,n]=s.fighters;this.animators[0].update(e,n,t,i,a.reducedMotion,a.blood),this.animators[1].update(n,e,t,i,a.reducedMotion,a.blood);let r=this.mapping.x(e.x),o=this.mapping.z(e.y),u=this.mapping.x(n.x),d=this.mapping.z(n.y);c=Math.hypot(r-u,o-d),l=e.is_downed||n.is_downed,this.tmpA.set(r,0,o),this.tmpB.set(u,0,d);for(let[e,n]of s.fighters.entries()){let r=(n.trauma.bleeding+n.trauma.left_cut+n.trauma.right_cut)/380;if(r>.05&&!n.is_downed){let n=e===0?this.tmpA:this.tmpB;this.tmpHead.set(n.x,1.56,n.z),this.effects.drip(this.tmpHead,r,t,a.reducedMotion)}else if(r>.3&&n.is_downed&&Math.random()<t*.8){let t=e===0?this.tmpA:this.tmpB;this.effects.pool(t.x+(Math.random()-.5)*.5,t.z+(Math.random()-.5)*.5,.8)}}}else this.tmpA.set(-.9,0,0),this.tmpB.set(.9,0,0);this.arena.update(i,t,a.reducedMotion),this.effects.update(t),this.updateReferee(t,i,a.reducedMotion),this.updateBlobShadows();let u=this.director.update(t,i,{x:this.tmpA.x,z:this.tmpA.z},{x:this.tmpB.x,z:this.tmpB.z},c,l,this.effects.shakeAmount,a.reducedMotion);this.camera.position.copy(u.position),this.camera.lookAt(u.lookAt),this.composer.render(),this.drawHudOverlay(s),this.destroyed||(this.raf=requestAnimationFrame(e=>this.draw(e)))}updateBlobShadows(){let e=[this.tmpA,this.tmpB,this.refereePosition];for(let[t,n]of this.blobShadows.entries()){let r=e[t];n.position.x=r.x,n.position.z=r.z;let i=t<2&&this.buffer.latest()?.fighters[t]?.is_downed===!0;n.scale.set(i?2.1:1.25,i?.9:.85,1)}}updateReferee(e,t,n){let r=(this.tmpA.x+this.tmpB.x)/2,i=(this.tmpA.z+this.tmpB.z)/2,a=this.refereeAway.set(this.refereePosition.x-r,0,this.refereePosition.z-i);a.lengthSq()<.01&&a.set(0,0,-1),a.normalize();let o=Bl.clamp(r+a.x*2.05,-2.4,2.4),s=Bl.clamp(i+a.z*2.05,-2.4,2.4),c=1-Math.exp(-1.6*e);this.refereePosition.x+=(o-this.refereePosition.x)*c,this.refereePosition.z+=(s-this.refereePosition.z)*c;for(let e of[this.tmpA,this.tmpB]){let t=this.refereePosition.x-e.x,n=this.refereePosition.z-e.z,r=Math.hypot(t,n);r<1.45&&r>.001&&(this.refereePosition.x=e.x+t/r*1.45,this.refereePosition.z=e.z+n/r*1.45)}this.referee.root.position.set(this.refereePosition.x,0,this.refereePosition.z);let l=((Math.atan2(r-this.refereePosition.x,i-this.refereePosition.z)-this.refereeYaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;this.refereeYaw+=l*(1-Math.exp(-3*e)),this.referee.root.rotation.y=this.refereeYaw,this.referee.hips.position.y=.98+(n?0:Math.sin(t*1.7)*.006)}drawHudOverlay(e){let t=Zy(this.hudCanvas);if(t===null)return;let{context:n,viewport:r}=t;if(n.clearRect(0,0,r.width,r.height),e===null)return;let i=Math.max(...e.fighters.map(e=>e.trauma.head+e.trauma.body));if(i>350){let e=n.createRadialGradient(r.width/2,r.height/2,r.width*.2,r.width/2,r.height/2,r.width*.72);e.addColorStop(0,`rgba(90,0,8,0)`),e.addColorStop(1,`rgba(75,0,8,${Math.min(.3,i/4600)})`),n.fillStyle=e,n.fillRect(0,0,r.width,r.height)}Gy(n,r.width,r.height,e,this.players,this.viewerId,this.final,this.reconnectMs,this.simulation.tick_rate)}destroy(){if(!this.destroyed){this.destroyed=!0,cancelAnimationFrame(this.raf),this.raf=0,this.buffer.clear(),this.dedupe.reset(),this.effects.dispose(),this.arena.dispose(),Xy(this.ring);for(let e of this.boxers)this.scene.remove(e.root),Vv(e);this.scene.remove(this.referee.root),Vv(this.referee);for(let e of this.lights)this.scene.remove(e);this.keyLight?.shadow.map?.dispose(),this.keyLight?.shadow.dispose(),this.renderer.renderLists.dispose(),this.composer.dispose(),this.renderer.dispose(),this.blobTexture.dispose();for(let e of this.blobShadows)this.scene.remove(e),e.geometry.dispose(),e.material.dispose();this.hudCanvas.remove()}}},tb=`hands.preferences.v1`,nb={length:0,clear:()=>void 0,getItem:()=>null,key:()=>null,removeItem:()=>void 0,setItem:()=>void 0},rb=()=>{try{return window.localStorage}catch{return nb}},ib=()=>({volume:.7,haptics:!0,reducedMotion:window.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches??!1,blood:`full`});function ab(e=rb()){let t=ib();try{let n=JSON.parse(e.getItem(tb)??`null`);if(typeof n!=`object`||!n||Array.isArray(n))return t;let r=n;return{volume:typeof r.volume==`number`&&Number.isFinite(r.volume)?Math.max(0,Math.min(1,r.volume)):t.volume,haptics:typeof r.haptics==`boolean`?r.haptics:t.haptics,reducedMotion:typeof r.reducedMotion==`boolean`?r.reducedMotion:t.reducedMotion,blood:r.blood===`reduced`||r.blood===`off`||r.blood===`full`?r.blood:t.blood}}catch{return t}}function ob(e,t=rb()){try{t.setItem(tb,JSON.stringify({volume:Math.max(0,Math.min(1,e.volume)),haptics:e.haptics,reducedMotion:e.reducedMotion,blood:e.blood}))}catch{}}var sb=class{value;listeners=new Set;constructor(e=rb()){this.storage=e,this.value=ab(e)}storage;get current(){return this.value}update(e){this.value={...this.value,...e},ob(this.value,this.storage);for(let e of this.listeners)e(this.value)}subscribe(e){return this.listeners.add(e),()=>this.listeners.delete(e)}destroy(){this.listeners.clear()}},cb={stage:`bootstrapping`,player:null,playerId:null,role:null,players:{},simulation:null,snapshot:null,final:null,serverTick:0,nextSequence:0,reconnectMs:0,safeError:null},lb=e=>Object.fromEntries(e.map(e=>[e.id,e]));function ub(e,t){if(t.type===`bootstrap`)return{...e,stage:`authorizing`,simulation:t.simulation,safeError:null};if(t.type===`authorized`)return{...e,stage:`connecting`,player:t.player,safeError:null};if(t.type===`connecting`)return{...e,stage:`connecting`};if(t.type===`reconnect-tick`)return{...e,stage:`paused`,reconnectMs:Math.max(0,t.remainingMs)};if(t.type===`fatal`)return{...e,stage:`fatal`,safeError:t.code,reconnectMs:0};let n=t.message;switch(n.type){case`welcome`:return{...e,playerId:n.role===`fighter`?n.player_id:null,role:n.role,players:lb(n.players),serverTick:n.server_tick,nextSequence:n.role===`fighter`?n.next_sequence:0,safeError:null};case`ticket`:return e;case`waiting`:return{...e,stage:`waiting`};case`ready`:return{...e,stage:e.snapshot?.phase??`countdown`,players:lb(n.players)};case`paused`:return{...e,stage:`paused`,reconnectMs:n.grace_ms};case`resumed`:return{...e,stage:e.snapshot?.phase??`countdown`,reconnectMs:0};case`snapshot`:return{...e,stage:n.payload.phase,snapshot:n.payload,serverTick:Math.max(e.serverTick,n.payload.tick)};case`final`:return{...e,stage:`complete`,final:n,reconnectMs:0};case`error`:return{...e,stage:`fatal`,safeError:n.code,reconnectMs:0}}}var db=class{root;reloadPage;state=cb;settings=new sb;input=new _s;audio=new n(()=>this.settings.current);haptics=new ts(()=>this.settings.current);feedbackEvents=new xs;renderer=null;network=null;session=null;abort=new AbortController;destroyed=!1;generation=0;reloadOnRetry=!1;canvas;status;roleIndicator;controlsButton;controlsPanel;retry;fightSummary;liveFightStatus;finalSummary;constructor(e,t=()=>window.location.reload()){this.root=e,this.reloadPage=t,e.innerHTML=`<section class="activity" aria-label="Hands boxing activity"><canvas class="fight" aria-label="Authoritative two-player boxing match"></canvas><header class="topbar"><strong>HANDS</strong><span>authoritative two-player boxing</span><span class="spectator-role" data-role hidden>SPECTATING · READ ONLY</span><button type="button" data-controls aria-expanded="false">Controls</button><button type="button" data-settings aria-expanded="false">Settings</button></header><section class="overlay" data-overlay><p class="status" data-status></p><button type="button" class="primary" data-retry hidden>Retry securely</button></section><aside class="panel" data-controls-panel hidden aria-label="Controls"><h2>Controls</h2><ul>${as.map(e=>`<li>${e}</li>`).join(``)}</ul></aside><aside class="panel settings" data-settings-panel hidden aria-label="Accessibility and feedback settings"><h2>Settings</h2><label>Volume <input data-volume type="range" min="0" max="1" step="0.05"></label><label><input data-haptics type="checkbox"> Haptics</label><label><input data-motion type="checkbox"> Reduced motion</label><label>Blood <select data-blood><option value="full">Full</option><option value="reduced">Reduced</option><option value="off">Off</option></select></label></aside><section class="sr-summary" data-fight-summary aria-label="Fight summary"></section><p class="sr-summary" data-fight-status role="status" aria-live="polite" aria-atomic="true"></p><section class="sr-summary" data-final aria-live="polite" aria-label="Final result"></section></section>`,this.canvas=e.querySelector(`canvas`),this.status=e.querySelector(`[data-status]`),this.roleIndicator=e.querySelector(`[data-role]`),this.controlsButton=e.querySelector(`[data-controls]`),this.controlsPanel=e.querySelector(`[data-controls-panel]`),this.retry=e.querySelector(`[data-retry]`),this.fightSummary=e.querySelector(`[data-fight-summary]`),this.liveFightStatus=e.querySelector(`[data-fight-status]`),this.finalSummary=e.querySelector(`[data-final]`),this.retry.addEventListener(`click`,this.onRetry),this.bindPanels(),this.syncSettings()}start(){this.authorize()}resetForAuthorization(){this.reloadOnRetry=!1,this.network?.dispose(),this.network=null,this.session?.destroy(),this.session=null,this.renderer?.destroy(),this.renderer=null,this.abort.abort(),this.abort=new AbortController,this.state=cb,this.feedbackEvents.reset(),this.input.setActive(!1),this.input.reset(),this.finalSummary.textContent=``,this.fightSummary.textContent=``,this.liveFightStatus.textContent=``}async authorize(){let e=++this.generation;this.resetForAuthorization(),this.dispatch({type:`connecting`}),this.setText(this.status,`Securing Discord Activity session…`),this.retry.hidden=!0;try{let t=await $o(this.abort.signal);if(this.destroyed||e!==this.generation){t.destroy();return}this.session=t,this.dispatch({type:`bootstrap`,simulation:t.bootstrap.simulation}),this.dispatch({type:`authorized`,player:t.player}),this.renderer=new eb(this.canvas,t.bootstrap.simulation,()=>this.settings.current);let n=t.takeTicket();if(n===null)throw Error(`ticket_unavailable`);let r=new Ts(n,()=>this.input.frame(),{onMessage:e=>this.receive(e),onReconnect:e=>{this.dispatch({type:`reconnect-tick`,remainingMs:e}),this.renderer?.setReconnect(e),this.renderState()},onFatal:e=>this.fail(e),onFreshAuth:()=>{e===this.generation&&this.authorize()}});this.network=r,r.start(),this.setText(this.status,`Connecting to the ring…`)}catch(t){!this.abort.signal.aborted&&e===this.generation&&(this.reloadOnRetry=t instanceof M&&t.reloadRequired,this.fail(me(t)))}}receive(e){if(e.type===`error`){this.fail(e.code);return}this.dispatch({type:`message`,message:e}),e.type===`snapshot`&&this.receiveSnapshot(e.payload),e.type===`final`&&(this.renderer?.setFinal(e),this.audio.result(e)),this.renderer?.setPlayers(this.state.players,this.state.playerId),this.renderer?.setReconnect(this.state.reconnectMs),this.renderState()}receiveSnapshot(e){this.renderer?.push(e);let t=e.fighters.find(e=>e.player_id===this.state.playerId);this.input.setKnockdown(t?.is_downed===!0),t!==void 0&&this.audio.snapshot(e.tick,t.stamina,t.maximum_stamina,t.trauma.head+t.trauma.body);for(let t of this.feedbackEvents.accept(e.events))this.audio.event(t),this.haptics.event(t)}dispatch(e){this.state=ub(this.state,e)}setText(e,t){e.textContent!==t&&(e.textContent=t)}renderState(){let e={bootstrapping:`Loading…`,authorizing:`Authorizing with Discord…`,connecting:`Connecting securely…`,waiting:`Waiting for one opponent to use Play now in this channel.`,countdown:`Bout countdown.`,fight:`Round ${this.state.snapshot?.round_number??1} in progress.`,knockdown:`Knockdown count ${this.state.snapshot?.fighters.find(e=>e.player_id===this.state.playerId)?.get_up_count??0}.`,foul_recovery:`Foul recovery in progress.`,rest:`Between-round rest.`,paused:`Connection paused. ${Math.ceil(this.state.reconnectMs/1e3)} seconds remain.`,complete:`Bout complete. Scorecards and rating changes are displayed.`,fatal:`Unable to continue (${this.state.safeError??`safe_error`}).`},t=this.state.role===`spectator`;this.setText(this.status,t?`Spectating — ${e[this.state.stage]}`:e[this.state.stage]),this.roleIndicator.hidden=!t,this.controlsButton.hidden=t,t&&(this.controlsPanel.hidden=!0,this.controlsButton.setAttribute(`aria-expanded`,`false`));let n=this.state.snapshot?.fighters.find(e=>e.player_id===this.state.playerId),r=t?`Spectating. ${e[this.state.stage]}`:this.state.stage===`knockdown`&&n?.is_downed===!0?`Knockdown. Count ${n.get_up_count}. ${n.get_up_prompt===null?`Wait for your private rhythm instruction.`:`Press ${n.get_up_prompt===`get_up_left`?`left`:`right`} now.`}`:this.state.stage===`paused`?`Connection paused.`:e[this.state.stage];this.setText(this.liveFightStatus,r),this.retry.hidden=this.state.stage!==`fatal`;let i=!t&&[`countdown`,`fight`,`knockdown`,`foul_recovery`].includes(this.state.stage);if(this.input.setActive(i),this.network?.setActive(i),this.renderFightSummary(),this.state.final!==null){let e=this.state.final;this.setText(this.finalSummary,`${e.method.replaceAll(`_`,` `)}. ${e.winner_id===null?`Draw`:`${this.state.players[e.winner_id]?.name??`Winner`} wins`}. Scorecards: ${e.scorecards.map(e=>`${e.judge}: ${e.player_one.reduce((e,t)=>e+t,0)} to ${e.player_two.reduce((e,t)=>e+t,0)}`).join(`; `)}. Ratings: ${Object.entries(e.ratings).map(([e,t])=>`${this.state.players[e]?.name??`fighter`} ${t.before} to ${t.after}`).join(`; `)}.`)}}renderFightSummary(){let e=this.state.snapshot;if(e===null)return;let t=this.state.simulation?.tick_rate??30,n=Math.floor(e.phase_ticks_remaining/t),r=`${Math.floor(n/60)}:${String(n%60).padStart(2,`0`)}`,i=e.fighters.map(e=>{let t=this.state.players[e.player_id];return`${t?.name??`Fighter`}, ELO ${t?.rating??`unknown`}, stamina ${Math.round(e.stamina)} of ${Math.round(e.maximum_stamina)}, guard ${Math.round(e.guard)}, poise ${Math.round(e.poise)}, conditioning ${Math.round(e.conditioning)}, ${e.warnings} warnings, ${e.knockdowns} knockdowns`}),a=e.fighters.find(e=>e.player_id===this.state.playerId),o=a?.is_downed===!0?a.get_up_prompt===null?`You are down. Count ${a.get_up_count}. Wait for your private rhythm instruction.`:`You are down. Count ${a.get_up_count}. Press ${a.get_up_prompt===`get_up_left`?`left`:`right`} now. Get-up progress ${a.get_up_meter} of ${a.get_up_required}.`:``;this.setText(this.fightSummary,`Round ${e.round_number}. ${e.phase.replace(`_`,` `)}. Clock ${r}. ${i.join(`. `)}. ${o}`.trim())}onRetry=()=>{if(this.reloadOnRetry){this.reloadPage();return}this.authorize()};bindPanels(){let e=(e,t)=>{let n=this.root.querySelector(e),r=this.root.querySelector(t);n.addEventListener(`click`,()=>{r.hidden=!r.hidden,n.setAttribute(`aria-expanded`,String(!r.hidden))})};e(`[data-controls]`,`[data-controls-panel]`),e(`[data-settings]`,`[data-settings-panel]`),this.root.querySelector(`[data-volume]`).addEventListener(`input`,e=>{this.settings.update({volume:Number(e.target.value)}),this.audio.setVolume()}),this.root.querySelector(`[data-haptics]`).addEventListener(`change`,e=>{this.settings.update({haptics:e.target.checked})}),this.root.querySelector(`[data-motion]`).addEventListener(`change`,e=>{let t=e.target.checked;this.settings.update({reducedMotion:t}),this.renderer?.setReducedMotion(t)}),this.root.querySelector(`[data-blood]`).addEventListener(`change`,e=>{let t=e.target.value;this.settings.update({blood:t}),this.renderer?.setBloodLevel(t)})}syncSettings(){let e=this.settings.current;this.root.querySelector(`[data-volume]`).value=String(e.volume),this.root.querySelector(`[data-haptics]`).checked=e.haptics,this.root.querySelector(`[data-motion]`).checked=e.reducedMotion,this.root.querySelector(`[data-blood]`).value=e.blood}fail(e){this.dispatch({type:`fatal`,code:e}),this.network?.dispose(),this.network=null,this.session?.destroy(),this.session=null,this.renderer?.destroy(),this.renderer=null,this.input.setActive(!1),this.input.reset(),this.renderState()}destroy(){this.destroyed||(this.destroyed=!0,this.generation+=1,this.abort.abort(),this.network?.dispose(),this.session?.destroy(),this.renderer?.destroy(),this.input.destroy(),this.audio.destroy(),this.settings.destroy(),this.retry.removeEventListener(`click`,this.onRetry),this.root.replaceChildren())}},fb=document.querySelector(`#app`);if(fb===null)throw Error(`app_root_missing`);var pb;{let e=new db(fb);e.start(),pb=()=>e.destroy()}window.addEventListener(`pagehide`,pb,{once:!0});