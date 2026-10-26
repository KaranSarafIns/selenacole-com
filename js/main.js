/* ============================================================
   SelenaCole.com — frontend behavior
   Chat widget display name comes from window.SC.chat.name
   STANDING RULE (Raj 2026-10-18): the widget is Selena's concierge — NEVER Selena
   herself. Display name binds to chatbot.name, subtitle to chatbot.subtitle.
   Defaults "Selena's Concierge" / "Her always-on helper — AI-powered, here 24/7".
   NEVER hardcoded.
   ============================================================ */
(function(){
"use strict";

var SC = window.SC || {};
var chatCfg = SC.chat || {};
/* Raj 2026-10-18 (locked): chatbot name = "Selena's Concierge", read from chatbot.name; never hardcoded. */
var CHAT_NAME = (chatCfg.name && String(chatCfg.name).trim()) || "Selena's Concierge";
var CHAT_SUBTITLE = (chatCfg.subtitle && String(chatCfg.subtitle).trim()) || "Her always-on helper \u2014 AI-powered, here 24/7";
var CHAT_OPENING = chatCfg.opening || "";
var CHAT_FALLBACK = chatCfg.fallback || "";
var CHAT_QA = chatCfg.qa || [];

function $(sel, root){ return (root||document).querySelector(sel); }
function $all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }

/* ---------- Theme switcher (token-driven, persisted) ---------- */
var THEMES = ["gold","noir","wine"];
function setTheme(t, persist){
  if(THEMES.indexOf(t) < 0) t = "gold";
  document.documentElement.setAttribute("data-theme", t);
  $all("[data-theme-select]").forEach(function(s){ s.value = t; });
  try{ if(persist !== false) localStorage.setItem("sc-theme", t); }catch(e){}
}
try{
  var saved = localStorage.getItem("sc-theme");
  if(saved && THEMES.indexOf(saved) >= 0) document.documentElement.setAttribute("data-theme", saved);
  else document.documentElement.setAttribute("data-theme", SC.themeDefault || "gold");
}catch(e){ document.documentElement.setAttribute("data-theme", "gold"); }
$all("[data-theme-select]").forEach(function(sel){
  sel.value = document.documentElement.getAttribute("data-theme");
  sel.addEventListener("change", function(){ setTheme(sel.value); });
});

/* ---------- Language switcher: jump to the same page in another language ---------- */
$all("[data-lang-select]").forEach(function(sel){
  sel.addEventListener("change", function(){
    var target = sel.value;                       // e.g. "es"
    var path = location.pathname;
    // strip existing /<lang>/ prefix (all langs except en-at-root)
    var m = path.match(/^\/(es|hi|gu|pa|fr|pt|de|it|ar|ja|ko|ru|zh)(\/|$)/);
    if(m) path = path.slice(m[1].length + 1) || "/";
    if(target === "en") location.href = path || "/";
    else location.href = "/" + target + (path === "/" ? "/" : path);
  });
});

/* ---------- Mobile nav: compact dropdown panel under the header ----------
   Raj 2026-10-26: the panel is min(320px,80vw), never full-screen; backdrop
   click closes it, Esc closes it, and tapping ANY link inside closes it
   before navigation. Round 3: height fits content (styles.css), and a click
   anywhere outside the panel closes it too (handler below). */
var navBackdrop = $("[data-nav-backdrop]");
function setNav(btn, nav, open){
  btn.setAttribute("aria-expanded", String(open));
  if(nav){
    nav.classList.toggle("open", open);
    nav.setAttribute("aria-hidden", String(!open));
  }
  if(navBackdrop) navBackdrop.hidden = !open;
  document.body.style.overflow = open ? "hidden" : "";
}
function closeNav(){
  $all(".nav-toggle").forEach(function(btn){
    if(btn.getAttribute("aria-expanded") === "true"){
      var nav = btn.closest(".site-header").querySelector(".mobile-nav");
      setNav(btn, nav, false);
    }
  });
}
$all(".nav-toggle").forEach(function(btn){
  btn.addEventListener("click", function(){
    var open = btn.getAttribute("aria-expanded") === "true";
    var nav = btn.closest(".site-header").querySelector(".mobile-nav");
    setNav(btn, nav, !open);
  });
});
if(navBackdrop) navBackdrop.addEventListener("click", closeNav);
$all(".mobile-nav a").forEach(function(a){
  a.addEventListener("click", function(){ closeNav(); });
});
/* Round 3 (Raj): tapping ANYWHERE outside the open panel closes it without
   navigating — the backdrop only covers the header strip (the header's
   backdrop-filter makes it the containing block for fixed children), so this
   document-level handler is what actually catches taps on page content.
   Clicks on the toggle itself (it toggles) and inside the panel are exempt. */
document.addEventListener("click", function(e){
  var anyOpen = $all(".nav-toggle").some(function(b){ return b.getAttribute("aria-expanded") === "true"; });
  if(!anyOpen) return;
  var t = e.target;
  if(t && t.closest && (t.closest(".mobile-nav") || t.closest(".nav-toggle"))) return;
  closeNav();
});

/* ---------- Announcement banner dismiss ---------- */
$all(".announce-bar [data-dismiss]").forEach(function(btn){
  btn.addEventListener("click", function(){
    var bar = btn.closest(".announce-bar");
    if(bar){ bar.hidden = true; try{ sessionStorage.setItem("sc-banner", "off"); }catch(e){} }
  });
});
try{ if(sessionStorage.getItem("sc-banner")==="off"){ $all(".announce-bar").forEach(function(b){ b.hidden = true; }); } }catch(e){}

/* ---------- Reveal on scroll ---------- */
if("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches){
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } });
  }, {threshold:.12});
  $all(".reveal").forEach(function(el){ io.observe(el); });
} else {
  $all(".reveal").forEach(function(el){ el.classList.add("in"); });
}

/* ---------- Chatbot widget (Selena-voiced UI; backend wires /api/chat) ---------- */
var chatPanel = $("#chatPanel"), chatBtn = $("#chatBtn"), chatBody = $("#chatBody"),
    chatForm = $("#chatForm"), chatInput = $("#chatInput");

/* Bind the widget display name from content — never hardcoded */
function bindChatName(){
  $all("[data-chat-name]").forEach(function(el){ el.textContent = CHAT_NAME; });
  $all("[data-chat-subtitle]").forEach(function(el){ el.textContent = CHAT_SUBTITLE; });
  if(chatBtn){ chatBtn.setAttribute("aria-label", CHAT_NAME); chatBtn.setAttribute("title", CHAT_NAME); }
  if(chatPanel) chatPanel.setAttribute("aria-label", CHAT_NAME + " — " + CHAT_SUBTITLE);
}
bindChatName();

function toggleChat(force){
  if(!chatPanel) return;
  var open = typeof force === "boolean" ? force : !chatPanel.classList.contains("open");
  chatPanel.classList.toggle("open", open);
  if(open && chatBody && !chatBody.dataset.seeded && CHAT_OPENING){
    addMsg("bot", CHAT_OPENING);
    chatBody.dataset.seeded = "1";
    var qr = $("#chatQuick");
    if(qr && chatCfg.quick_replies){
      chatCfg.quick_replies.forEach(function(q){
        var b = document.createElement("button");
        b.type = "button"; b.textContent = q;
        b.addEventListener("click", function(){ sendChat(q); });
        qr.appendChild(b);
      });
    }
  }
  if(open && chatInput) setTimeout(function(){ chatInput.focus(); }, 150);
}
if(chatBtn) chatBtn.addEventListener("click", function(){ toggleChat(); });
$all("[data-chat-close]").forEach(function(b){ b.addEventListener("click", function(){ toggleChat(false); }); });

function addMsg(who, text){
  if(!chatBody) return;
  var d = document.createElement("div");
  d.className = "msg " + who; d.textContent = text;
  chatBody.appendChild(d);
  chatBody.scrollTop = chatBody.scrollHeight;
}
function localAnswer(q){
  var s = q.toLowerCase();
  for(var i=0;i<CHAT_QA.length;i++){
    var pair = CHAT_QA[i];
    var qq = (pair.q||"").toLowerCase();
    var words = qq.replace(/[?.,!]/g,"").split(/\s+/).filter(function(w){ return w.length > 3; });
    var hits = words.filter(function(w){ return s.indexOf(w) >= 0; }).length;
    if(hits >= 2 || (qq && s.indexOf(qq.slice(0,24)) >= 0)) return pair.a;
  }
  return null;
}
function sendChat(text){
  text = (text||"").trim();
  if(!text || !chatBody) return;
  addMsg("user", text);
  if(chatInput) chatInput.value = "";
  var local = localAnswer(text);
  if(local){ setTimeout(function(){ addMsg("bot", local); }, 450); return; }
  /* Backend-owned endpoint; graceful offline state in her voice */
  fetch("/api/chat", {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({message:text, page:location.pathname})})
    .then(function(r){ return r.ok ? r.json() : Promise.reject(); })
    .then(function(d){ addMsg("bot", d.answer || d.reply || CHAT_FALLBACK || "…"); })
    .catch(function(){
      if(/partner|brand|collab|sponsor|press|business|work with/i.test(text) && chatCfg.partner_hint)
        addMsg("bot", chatCfg.partner_hint);
      else addMsg("bot", CHAT_FALLBACK || "The concierge is stepping out for a moment — try again in a bit, or write via the contact page.");
    });
}
if(chatForm) chatForm.addEventListener("submit", function(e){
  e.preventDefault();
  sendChat(chatInput ? chatInput.value : "");
});

/* ---------- Accessibility widget (InsuranceBonanza-style) ---------- */
var a11yPanel = $("#a11yPanel"), a11yBtn = $("#a11yBtn");
function toggleA11y(force){
  if(!a11yPanel) return;
  var open = typeof force === "boolean" ? force : !a11yPanel.classList.contains("open");
  a11yPanel.classList.toggle("open", open);
}
if(a11yBtn) a11yBtn.addEventListener("click", function(){ toggleA11y(); });
$all("[data-a11y-close]").forEach(function(b){ b.addEventListener("click", function(){ toggleA11y(false); }); });

var a11yState = {size:100, contrast:false, gray:false, negative:false, readable:false, pause:false, focus:false};
try{ var sv = JSON.parse(localStorage.getItem("sc-a11y")||"null"); if(sv) a11yState = sv; }catch(e){}
function applyA11y(){
  document.documentElement.style.fontSize = (a11yState.size/100*100) + "%";
  document.body.classList.toggle("a11y-contrast", a11yState.contrast);
  document.body.classList.toggle("a11y-grayscale", a11yState.gray);
  document.body.classList.toggle("a11y-negative", a11yState.negative);
  document.body.classList.toggle("readable-font", a11yState.readable);
  document.body.classList.toggle("a11y-pause-motion", a11yState.pause);
  document.body.classList.toggle("a11y-focus", a11yState.focus);
  $all("[data-a11y-switch]").forEach(function(sw){
    var k = sw.getAttribute("data-a11y-switch");
    sw.setAttribute("aria-checked", String(!!a11yState[k]));
  });
  var sz = $("#a11ySizeVal"); if(sz) sz.textContent = a11yState.size + "%";
  try{ localStorage.setItem("sc-a11y", JSON.stringify(a11yState)); }catch(e){}
}
$all("[data-a11y-size]").forEach(function(b){
  b.addEventListener("click", function(){
    var d = parseInt(b.getAttribute("data-a11y-size"),10);
    a11yState.size = Math.min(140, Math.max(80, a11yState.size + d));
    applyA11y();
  });
});
$all("[data-a11y-switch]").forEach(function(sw){
  sw.addEventListener("click", function(){
    var k = sw.getAttribute("data-a11y-switch");
    if(k === "reset"){ a11yState = {size:100,contrast:false,gray:false,negative:false,readable:false,pause:false,focus:false}; }
    else a11yState[k] = !a11yState[k];
    applyA11y();
  });
});
/* Landmarks jump list */
var lm = $("#a11yLandmarks");
if(lm){
  [["header","Header"],["main","Main content"],["nav","Navigation"],["footer","Footer"]].forEach(function(pair){
    var el = document.querySelector(pair[0]);
    if(!el) return;
    if(!el.id) el.id = "lm-" + pair[0];
    var a = document.createElement("a");
    a.href = "#" + el.id; a.textContent = pair[1];
    a.style.cssText = "display:block;padding:.3rem 0;color:inherit";
    lm.appendChild(a);
  });
}
applyA11y();

/* ---------- Share buttons (gallery) ---------- */
$all("[data-share]").forEach(function(btn){
  btn.addEventListener("click", function(){
    var url = btn.getAttribute("data-share-url") || location.href;
    var title = btn.getAttribute("data-share-title") || document.title;
    if(navigator.share){
      navigator.share({title:title, url:url}).catch(function(){});
    } else if(navigator.clipboard){
      navigator.clipboard.writeText(url).then(function(){
        var ok = btn.getAttribute("data-copied") || "Link copied!";
        var orig = btn.innerHTML;
        btn.textContent = ok;
        setTimeout(function(){ btn.innerHTML = orig; }, 1600);
      });
    }
  });
});

/* ---------- Mood filter (watch page) ---------- */
$all("[data-mood-filter]").forEach(function(btn){
  btn.addEventListener("click", function(){
    var mood = btn.getAttribute("data-mood-filter");
    $all("[data-mood-filter]").forEach(function(b){ b.classList.toggle("active", b===btn); });
    $all("[data-mood]").forEach(function(card){
      card.style.display = (mood === "all" || card.getAttribute("data-mood") === mood) ? "" : "none";
    });
  });
});

/* ---------- Premiere countdown ---------- */
$all("[data-countdown-to]").forEach(function(el){
  var target = new Date(el.getAttribute("data-countdown-to")).getTime();
  function tick(){
    var diff = target - Date.now();
    if(diff <= 0){ el.innerHTML = ""; return; }
    var d = Math.floor(diff/864e5), h = Math.floor(diff/36e5)%24,
        m = Math.floor(diff/6e4)%60, s = Math.floor(diff/1e3)%60;
    function cell(v,l){ return '<div class="cd"><b>'+v+'</b><span>'+l+'</span></div>'; }
    el.innerHTML = cell(d,"days")+cell(h,"hrs")+cell(m,"min")+cell(s,"sec");
  }
  tick(); setInterval(tick, 1000);
});

/* ---------- Forms: generic POST with visible confirmation state ---------- */
$all("form[data-endpoint]").forEach(function(form){
  form.addEventListener("submit", function(e){
    e.preventDefault();
    var valid = true;
    $all("[data-required]", form).forEach(function(inp){
      var field = inp.closest(".field");
      var bad = !inp.value.trim() ||
        (inp.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inp.value.trim()));
      if(field) field.classList.toggle("invalid", bad);
      if(bad) valid = false;
    });
    if(!valid) return;
    var btn = form.querySelector('[type="submit"]');
    var orig = btn ? btn.textContent : "";
    if(btn){ btn.disabled = true; btn.textContent = "…"; }
    var data = {};
    $all("input,select,textarea", form).forEach(function(i){ if(i.name) data[i.name] = i.value; });
    fetch(form.getAttribute("data-endpoint"), {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(data)
    }).then(function(r){ return r.ok ? r.json().catch(function(){ return {}; }) : Promise.reject(new Error("bad")); })
    .then(function(){
      var ok = form.parentElement.querySelector(".form-success");
      if(ok){
        form.style.display = "none";
        ok.classList.add("show");
      }
    }).catch(function(){
      var note = form.querySelector(".form-note");
      if(note) note.textContent = form.getAttribute("data-error") || "Something hiccuped — please try again.";
      if(btn){ btn.disabled = false; btn.textContent = orig; }
    });
  });
});

/* ---------- Download protection (casual saving — Raj 2026-10-26) ----------
   One delegated listener: right-click on any photo/video or its card does
   nothing. Dragging is off via CSS (-webkit-user-drag) + draggable=false set
   here and in the generated markup. Videos carry controlsList="nodownload"
   and disablepictureinpicture (markup + set here for any stray <video>).
   This stops casual saving only — that is the accepted scope. */
document.addEventListener("contextmenu", function(e){
  var t = e.target;
  if(t && t.closest && t.closest("img, video, .reel-card, .photo-card, .portrait, .hero-media, .lightbox")) e.preventDefault();
});
$all("img").forEach(function(img){ img.setAttribute("draggable", "false"); });
$all("video").forEach(function(v){
  try{ if(v.controlsList) v.controlsList.add("nodownload"); }catch(err){}
  v.setAttribute("disablepictureinpicture", "");
});

/* ---------- Media lightbox (shared: videos + gallery photos) ----------
   Video cards are posters with a play button (data-lightbox-video): click
   opens the video LARGE with sound (a user gesture, so unmuted autoplay is
   allowed) and native controls. Round 3 (Raj): videos sharing a
   data-lightbox-group (home reel strip, each Watch collection) form one
   playlist — prev/next arrows, arrow keys, and touch swipe move between
   them without closing; a video with no group (the premieres) is standalone.
   Navigating pauses the outgoing video. Gallery photos (data-lightbox-photo)
   open enlarged with caption + the same prev/next/swipe.
   Close: x button, Esc, or backdrop click. Video pauses + resets on close.
   Theme-aware via CSS vars; the close button takes focus on open. */
var lb = $("#lightbox"),
    lbImg = lb ? $(".lb-img", lb) : null,
    lbVid = lb ? $(".lb-video", lb) : null,
    lbCap = lb ? $(".lb-cap", lb) : null,
    lbPrevBtn = lb ? $("[data-lb-prev]", lb) : null,
    lbNextBtn = lb ? $("[data-lb-next]", lb) : null,
    lbCloseBtn = lb ? $("[data-lb-close]", lb) : null;
var lbGroup = [], lbIndex = 0, lbMode = "image", lbLastFocus = null;

function lbRender(){
  var item = lbGroup[lbIndex];
  if(!item) return;
  if(lbMode === "video"){
    lbImg.hidden = true;
    lbVid.hidden = false;
    lbCap.textContent = item.cap || "";
    lbVid.poster = item.poster || "";
    if(lbVid.getAttribute("src") !== item.src){
      try{ lbVid.pause(); }catch(e){}
      lbVid.src = item.src;
    }
    lbVid.muted = false;
    var pr = lbVid.play();
    if(pr && pr.catch) pr.catch(function(){});
  } else {
    lbVid.hidden = true;
    lbImg.hidden = false;
    lbImg.src = item.src;
    lbImg.alt = item.cap || "";
    lbCap.textContent = item.cap || "";
  }
  var multi = lbGroup.length > 1;
  if(lbPrevBtn){
    lbPrevBtn.style.display = multi ? "" : "none";
    lbPrevBtn.setAttribute("aria-label", lbMode === "video" ? "Previous video" : "Previous photo");
  }
  if(lbNextBtn){
    lbNextBtn.style.display = multi ? "" : "none";
    lbNextBtn.setAttribute("aria-label", lbMode === "video" ? "Next video" : "Next photo");
  }
}
function openLightbox(mode, group, index){
  if(!lb || !group.length) return;
  lbMode = mode; lbGroup = group; lbIndex = index || 0;
  lbLastFocus = document.activeElement;
  lb.hidden = false;
  document.body.style.overflow = "hidden";
  lbRender();
  if(lbCloseBtn) lbCloseBtn.focus();
}
function closeLightbox(){
  if(!lb || lb.hidden) return;
  if(lbVid){
    try{ lbVid.pause(); }catch(e){}
    lbVid.removeAttribute("src");
    lbVid.removeAttribute("poster");
    lbVid.load();
  }
  lb.hidden = true;
  document.body.style.overflow = "";
  if(lbLastFocus && lbLastFocus.focus) lbLastFocus.focus();
}
function lbStep(d){
  if(lbGroup.length < 2) return;
  if(lbMode === "video" && lbVid){ try{ lbVid.pause(); }catch(e){} }
  lbIndex = (lbIndex + d + lbGroup.length) % lbGroup.length;
  lbRender();
}
document.addEventListener("click", function(e){
  var t = e.target;
  if(!t || !t.closest) return;
  var vb = t.closest("[data-lightbox-video]");
  if(vb){
    var groupName = vb.getAttribute("data-lightbox-group");
    var buttons = groupName
      ? $all('[data-lightbox-video][data-lightbox-group="' + groupName + '"]')
      : [vb];
    if(!buttons.length) buttons = [vb];
    var vGroup = buttons.map(function(b){
      var posterImg = b.querySelector("img");
      return {
        src: b.getAttribute("data-lightbox-video"),
        cap: b.getAttribute("data-lightbox-caption") || "",
        poster: posterImg ? posterImg.getAttribute("src") : ""
      };
    });
    openLightbox("video", vGroup, buttons.indexOf(vb));
    return;
  }
  var ph = t.closest("[data-lightbox-photo]");
  if(ph){
    var imgs = $all("[data-lightbox-photo]");
    var group = imgs.map(function(im){
      var fig = im.closest("figure");
      var capEl = fig ? fig.querySelector("figcaption") : null;
      return {src: im.getAttribute("src"),
              cap: (capEl ? capEl.textContent.trim() : "") || im.getAttribute("alt") || ""};
    });
    openLightbox("image", group, imgs.indexOf(ph));
  }
});
if(lb){
  lb.addEventListener("click", function(e){ if(e.target === lb) closeLightbox(); });
  if(lbCloseBtn) lbCloseBtn.addEventListener("click", closeLightbox);
  if(lbPrevBtn) lbPrevBtn.addEventListener("click", function(){ lbStep(-1); });
  if(lbNextBtn) lbNextBtn.addEventListener("click", function(){ lbStep(1); });
  /* Touch swipe (round 3): a mostly-horizontal swipe over 48px moves to the
     previous/next item in either mode. A recognized swipe swallows the
     synthetic click so it can't also toggle the video's play state. */
  var lbTouchX = null, lbTouchY = null;
  lb.addEventListener("touchstart", function(e){
    if(e.touches.length === 1){
      lbTouchX = e.touches[0].clientX;
      lbTouchY = e.touches[0].clientY;
    }
  }, {passive:true});
  lb.addEventListener("touchend", function(e){
    if(lbTouchX === null || lbGroup.length < 2){ lbTouchX = null; return; }
    var t = e.changedTouches[0];
    var dx = t.clientX - lbTouchX, dy = t.clientY - lbTouchY;
    lbTouchX = null;
    if(Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5){
      e.preventDefault();
      lbStep(dx < 0 ? 1 : -1);
    }
  }, {passive:false});
}

/* ---------- Studio hero picker (runtime swap) ----------
   The baked-in homepage hero is the champagne penthouse (item 16) — the
   static fallback that can never break. Raj can pick a different hero in
   Studio → Settings → "Homepage hero image": the choice is stored in
   site_settings.hero_image, published by /api/content, and swapped in here.
   Uploads from his PC arrive as absolute bucket URLs; presets are /assets
   paths — both work as-is. Any failure (API down, empty value) silently
   keeps the baked hero. */
var HERO_ALTS = {
  "/assets/hero-penthouse.webp": "Selena Cole in a champagne slip dress, smiling in a penthouse at sunset, the city skyline behind her",
  "/assets/hero-garden-wide.webp": "Selena Cole in a floral dress, smiling in a sunlit garden above the sea",
  "/assets/hero-red-rooftop.webp": "Selena Cole in a red satin dress on a rooftop at sunset, the city skyline behind her",
  "/assets/hero-white-camisole.webp": "Selena Cole in a white camisole and jeans, smiling in bright daylight"
};
var heroImgEl = document.querySelector("[data-hero-img]");
if(heroImgEl){
  var pageLang = (document.documentElement.getAttribute("lang") || "en").toLowerCase();
  fetch("/api/content?lang=" + encodeURIComponent(pageLang), {cache: "no-store"})
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      var url = d && d.settings && d.settings.hero_image;
      if(!url || typeof url !== "string") return;
      if(heroImgEl.getAttribute("src") !== url){
        heroImgEl.src = url;
        if(HERO_ALTS[url]) heroImgEl.alt = HERO_ALTS[url];
      }
    })
    .catch(function(){});
}

/* Escape closes panels; arrows navigate the lightbox group (photos + videos) */
document.addEventListener("keydown", function(e){
  if(lb && !lb.hidden){
    if(e.key === "Escape"){ closeLightbox(); return; }
    if(e.key === "ArrowLeft"){ lbStep(-1); return; }
    if(e.key === "ArrowRight"){ lbStep(1); return; }
  }
  if(e.key === "Escape"){ toggleChat(false); toggleA11y(false); closeNav(); }
});
})();
