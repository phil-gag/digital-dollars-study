(function () {
  "use strict";

  var C = window.RTI_CONFIG;
  var app = document.getElementById("rti-app");
  var bar = document.getElementById("rti-progress-bar");
  var P = new URLSearchParams(window.location.search);
  // Set by the Qualtrics question that hosts the study: {arm, pid, study, session, stratum, test, done(record)}.
  var QX = window.RTI_QUALTRICS || null;
  var TEST = P.get("test") === "1" || !!(QX && QX.test);
  var PIPE = "https://pipe.jspsych.org/api/";

  // ---------- utilities ----------
  function rand() {
    var a = new Uint32Array(1);
    window.crypto.getRandomValues(a);
    return a[0] / 4294967296;
  }
  function rid() {
    var s = "", chars = "abcdefghijkmnpqrstuvwxyz23456789";
    for (var i = 0; i < 12; i++) s += chars.charAt(Math.floor(rand() * chars.length));
    return s;
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------- data record (one flat object per participant) ----------
  var D = {
    rid: rid(),
    version: C.version,
    PROLIFIC_PID: (QX && QX.pid) || P.get("PROLIFIC_PID") || "",
    STUDY_ID: (QX && QX.study) || P.get("STUDY_ID") || "",
    SESSION_ID: (QX && QX.session) || P.get("SESSION_ID") || "",
    stratum: (QX && QX.stratum) || P.get("stratum") || "unknown",
    host: QX ? "qualtrics" : "web",
    test: TEST ? 1 : 0,
    t_start: new Date().toISOString()
  };

  // ---------- stimuli ----------
  var COINS = {
    PFD: { name: "Passfield Dollar", tk: "PFD", art: "A", issuer: "Passfield Digital",
      sentence: "Issued by Passfield Digital LLC, a subsidiary of Passfield Bank, N.A., an FDIC-insured bank." },
    BRD: { name: "Bricola Dollar", tk: "BRD", art: "A", issuer: "Bricola",
      sentence: "Issued by Bricola Inc., a payments company." },
    ORD: { name: "Orbit Dollar", tk: "ORD", art: "An", issuer: "Orbit Pay",
      sentence: "Issued by Orbit Pay LLC, a subsidiary of Orbit, a large technology company known for search, devices and cloud services." }
  };
  var LABEL = "Permitted payment stablecoin issuer. Federally supervised under the GENIUS Act.";
  var MARKER = {
    none: "",
    label: LABEL,
    disc: LABEL + " Not FDIC-insured. Not a bank deposit. Not guaranteed by the U.S. government. If the issuer fails, holders are paid first from its reserves."
  };

  function coinRow(code, arm) {
    var c = COINS[code], m = MARKER[arm];
    return '<div class="rti-coin" data-coin="' + code + '">' +
      '<div class="rti-icon">' + c.tk + '</div>' +
      '<div class="rti-body">' +
      '<div class="rti-name">' + esc(c.name) + ' <span class="tk">(' + c.tk + ')</span></div>' +
      '<div class="rti-issuer">' + esc(c.sentence) + '</div>' +
      '<div class="rti-value">1 coin = $1.00. Redeem for US dollars.</div>' +
      (m ? '<div class="rti-marker">' + esc(m) + '</div>' : '') +
      '</div><div class="rti-bal">$0.00</div></div>';
  }
  function walletHTML(order, arm) {
    return '<div class="rti-wallet">' +
      '<div class="rti-top"><span>9:41</span><span>Wallet</span></div>' +
      '<div class="rti-title">Digital dollars</div>' +
      '<div class="rti-tabs"><span>Cards</span><span>Accounts</span><span class="on">Digital dollars</span></div>' +
      '<div class="rti-sub">US dollar stablecoins available in this app</div>' +
      order.map(function (c) { return coinRow(c, arm); }).join("") + '</div>';
  }
  function cardHTML(code, arm) {
    return '<div class="rti-wallet card">' + coinRow(code, arm) + '</div>';
  }

  // ---------- item renderers ----------
  // Each item spec: {type, name, text, ...}. "optional" items never trigger the missing-answer prompt.
  function radioHTML(it) {
    return '<fieldset class="q" data-name="' + it.name + '"><legend>' + it.text + '</legend><div class="opts">' +
      it.options.map(function (o) {
        return '<label class="opt"><input type="radio" name="' + it.name + '" value="' + o[0] + '"><span>' + o[1] + '</span></label>';
      }).join("") + '</div></fieldset>';
  }
  function checkHTML(it) {
    return '<fieldset class="q" data-name="' + it.name + '"><legend>' + it.text + '</legend><div class="opts">' +
      it.options.map(function (o) {
        return '<label class="opt"><input type="checkbox" name="' + it.name + '" value="' + o[0] + '"' +
          (o[2] ? ' data-exclusive="1"' : '') + '><span>' + o[1] + '</span></label>';
      }).join("") + '</div></fieldset>';
  }
  function scaleHTML(it, inRow) {
    var cells = it.values.map(function (v) {
      return '<label><input type="radio" name="' + it.name + '" value="' + v + '"><span>' + v + '</span></label>';
    }).join("");
    (it.extra || []).forEach(function (e) {
      cells += '<label class="wide"><input type="radio" name="' + it.name + '" value="' + e[0] + '"><span>' + e[1] + '</span></label>';
    });
    var body = '<div class="scale">' + cells + '</div>' +
      '<div class="anchors"><span>' + it.left + '</span><span>' + it.right + '</span></div>';
    if (inRow) return '<div class="row q" data-name="' + it.name + '"><div class="qtext">' + it.text + '</div>' + body + '</div>';
    return '<fieldset class="q" data-name="' + it.name + '"><legend>' + it.text + '</legend>' + body + '</fieldset>';
  }
  function sliderHTML(it, inRow) {
    var body = '<div class="slider-wrap"><input type="range" class="untouched" min="0" max="100" step="1" value="50" name="' + it.name + '" aria-label="' + esc(it.aria || it.name) + '">' +
      (it.showValue ? '<span class="slider-val" data-for="' + it.name + '">--</span>' : '') + '</div>' +
      '<div class="slider-anchors' + (it.showValue ? '' : ' nov') + '"><span>' + it.left + '</span>' +
      (it.mid ? '<span>' + it.mid + '</span>' : '') + '<span>' + it.right + '</span></div>';
    var cls = inRow ? 'row q' : 'q';
    return '<div class="' + cls + '" data-name="' + it.name + '"><div class="qtext">' + it.text + '</div>' + body + '</div>';
  }
  function textHTML(it) {
    return '<div class="q" data-name="' + it.name + '"><div class="qtext">' + it.text + '</div><textarea name="' + it.name + '" maxlength="2000"></textarea></div>';
  }
  function itemHTML(it, inRow) {
    if (it.type === "radio") return radioHTML(it);
    if (it.type === "check") return checkHTML(it);
    if (it.type === "scale") return scaleHTML(it, inRow);
    if (it.type === "slider") return sliderHTML(it, inRow);
    if (it.type === "text") return textHTML(it);
    return "";
  }

  function readItem(el, it) {
    if (it.type === "radio" || it.type === "scale") {
      var x = el.querySelector('input[name="' + it.name + '"]:checked');
      return x ? Number(x.value) : null;
    }
    if (it.type === "slider") {
      var s = el.querySelector('input[name="' + it.name + '"]');
      return s.classList.contains("untouched") ? null : Number(s.value);
    }
    if (it.type === "check") {
      var vals = [];
      el.querySelectorAll('input[name="' + it.name + '"]:checked').forEach(function (b) { vals.push(b.value); });
      return vals.length ? vals : null;
    }
    if (it.type === "text") {
      var t = el.querySelector('textarea[name="' + it.name + '"]').value.trim();
      return t || null;
    }
    return null;
  }
  function storeItem(it, v) {
    if (it.type === "check") {
      it.options.forEach(function (o) { D[it.name + "_" + o[0]] = v ? (v.indexOf(String(o[0])) >= 0 ? 1 : 0) : null; });
    } else {
      D[it.name] = v;
    }
  }

  function wire(el) {
    el.querySelectorAll(".scale input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        el.querySelectorAll('input[name="' + inp.name + '"]').forEach(function (o) {
          o.parentNode.classList.toggle("sel", o.checked);
        });
      });
    });
    el.querySelectorAll('input[type=range]').forEach(function (r) {
      var touch = function () {
        r.classList.remove("untouched");
        var v = el.querySelector('.slider-val[data-for="' + r.name + '"]');
        if (v) v.textContent = r.value;
      };
      r.addEventListener("input", touch);
      r.addEventListener("change", touch);
      r.addEventListener("pointerdown", touch);
    });
    el.querySelectorAll('input[type=checkbox]').forEach(function (b) {
      b.addEventListener("change", function () {
        if (!b.checked) return;
        el.querySelectorAll('input[name="' + b.name + '"]').forEach(function (o) {
          if (o === b) return;
          if (b.dataset.exclusive || o.dataset.exclusive) o.checked = false;
        });
      });
    });
  }

  // ---------- page-leave tracking ----------
  var vis = null;
  D.vis_n_total = 0; D.blur_n_total = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) D.vis_n_total++;
    if (!vis) return;
    if (document.hidden) { vis.n++; vis.hs = Date.now(); }
    else if (vis.hs) { vis.ms += Date.now() - vis.hs; vis.hs = 0; }
  });
  window.addEventListener("blur", function () {
    D.blur_n_total++;
    if (vis) vis.b++;
  });

  // ---------- page engine ----------
  var pages = [], idx = 0, tPage = 0;

  function render() {
    var pg = pages[idx];
    bar.style.width = Math.round(100 * idx / pages.length) + "%";
    var html = (TEST ? '<div class="testbar">TEST MODE: arm = ' + (D.arm || "not yet assigned") + '; page ' + (idx + 1) + ' of ' + pages.length + ' (' + pg.id + '). Nothing is saved.</div>' : '') +
      '<div class="panel">' + (pg.top || "") +
      (pg.items || []).map(function (it) { return itemHTML(it, pg.rows); }).join("") +
      (pg.bottom || "") +
      '<div class="warn hidden" id="warn"></div><div class="err hidden" id="err"></div>' +
      '<div class="nav"><button class="next" id="next">' + (pg.button || "Next") + '</button></div></div>';
    app.innerHTML = html;
    window.scrollTo(0, 0);
    wire(app);
    pg.warned = false;
    tPage = Date.now();
    if (pg.track) vis = { n: 0, ms: 0, b: 0, hs: 0 };
    if (pg.onShow) pg.onShow(app);
    document.getElementById("next").addEventListener("click", next);
  }

  function next() {
    var pg = pages[idx];
    var btn = document.getElementById("next");
    var warn = document.getElementById("warn"), err = document.getElementById("err");
    err.classList.add("hidden");
    var missing = [];
    (pg.items || []).forEach(function (it) {
      var v = readItem(app, it);
      var box = app.querySelector('.q[data-name="' + it.name + '"]');
      if (v === null && !it.optional) { missing.push(it.name); if (box) box.classList.add("missing"); }
      else if (box) box.classList.remove("missing");
    });
    if (pg.validate) {
      var e = pg.validate(app);
      if (e) { err.innerHTML = e; err.classList.remove("hidden"); return; }
    }
    if (pg.strict && missing.length) {
      warn.innerHTML = "Please answer every statement to continue.";
      warn.classList.remove("hidden");
      return;
    }
    var extraMissing = pg.countMissing ? pg.countMissing(app) : 0;
    var nMiss = missing.length + extraMissing;
    if (nMiss && !pg.warned) {
      pg.warned = true;
      warn.innerHTML = "You have not answered " + (nMiss === 1 ? "one question" : nMiss + " questions") +
        " on this page. You can answer " + (nMiss === 1 ? "it" : "them") + " now, or click the button again to continue without answering.";
      warn.classList.remove("hidden");
      return;
    }
    (pg.items || []).forEach(function (it) { storeItem(it, readItem(app, it)); });
    D["t_" + pg.id] = Date.now() - tPage;
    if (pg.track && vis) {
      if (vis.hs) { vis.ms += Date.now() - vis.hs; }
      D["vis_n_" + pg.track] = vis.n; D["vis_ms_" + pg.track] = vis.ms; D["blur_n_" + pg.track] = vis.b;
      vis = null;
    }
    btn.disabled = true;
    Promise.resolve(pg.after ? pg.after(app) : null).then(function (stop) {
      if (stop === "stop") return;
      idx++;
      if (idx < pages.length) render();
    });
  }

  // ---------- scales ----------
  function s11(name, text) {
    return { type: "scale", name: name, text: text, values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      extra: [[99, "Don't know"]], left: "0 = No trust at all", right: "10 = Complete trust" };
  }
  function s7(name, text) {
    return { type: "scale", name: name, text: text, values: [1, 2, 3, 4, 5, 6, 7],
      left: "1 = Strongly disagree", right: "7 = Strongly agree" };
  }
  function s6(name, text) {
    return { type: "scale", name: name, text: text, values: [1, 2, 3, 4, 5, 6],
      left: "1 = Strongly disagree", right: "6 = Strongly agree" };
  }

  // ---------- pages ----------
  function consentPage() {
    var yn = [[1, "Yes"], [0, "No"]];
    var info =
      '<h1>Digital dollars in a wallet app</h1>' +
      '<h2>Information for participants</h2>' +
      '<p><b>What is the research about?</b> Stablecoins are digital tokens meant to stay worth one US dollar. People may soon see them in apps they already use. I want to understand what people believe about a stablecoin when they see it in an app. The study is run by Philipp Gagel at the London School of Economics (LSE) and funded by the LSE Phelan US Centre. The app, companies and tokens in the study are made up.</p>' +
      '<p><b>Do I have to take part?</b> No. If you decide to take part, please answer Yes to each statement below. You can continue only if you answer Yes to all of them.</p>' +
      '<p><b>What will my involvement be?</b> One online session of about 10 minutes. You will answer questions about how much you trust different organizations, three short questions about money, and questions about a made-up app screen with three made-up tokens. People see slightly different versions of the screen. You will receive the payment shown on Prolific. There is no bonus, and your payment does not depend on your answers.</p>' +
      '<p><b>How do I withdraw?</b> You can stop at any time before you submit by closing the page. You do not have to answer any question you do not want to answer. Once you have submitted, I cannot remove your answers, because the file I analyse does not contain your name.</p>' +
      '<p><b>What will my information be used for?</b> A PhD thesis, academic publications, a short evidence summary for policymakers, and possible future research. Results will be combined. Anonymised answers will be shared in a public research data repository. I will not put your personal information into a generative AI tool.</p>' +
      '<p><b>Confidentiality.</b> I will not ask for your name, address or payment details, and your IP address is not stored with your answers. Your Prolific ID is used only to approve payment and is kept separate from your answers. The survey records whether you leave the page while answering some questions, and Prolific runs an automated check that the survey was completed by a person. No other device or location data are collected. Your answers are stored in LSE\'s Qualtrics account and then on LSE OneDrive.</p>' +
      '<p><b>Data protection.</b> LSE Research Privacy Notice: <a href="https://info.lse.ac.uk/staff/divisions/Secretarys-Division/Assets/Documents/Information-Records-Management/Privacy-Notice-for-Research-v1.2.pdf" target="_blank" rel="noopener">link</a>. The legal basis is legitimate interests. To request a copy of your data, contact glpd.info.rights@lse.ac.uk.</p>' +
      '<p><b>Ethics review.</b> This study has undergone ethics review in accordance with the LSE Research Ethics Policy and Procedure.</p>' +
      '<p><b>Questions, concerns or complaints.</b> Please contact Philipp Gagel directly at ' + C.contactEmail + ' or through Prolific.</p>' +
      '<h2>Consent</h2>';
    return {
      id: "consent", top: info, strict: true, button: "Continue",
      items: [
        { type: "radio", name: "C1", text: "I have read and understood the study information dated " + C.infoDate + ".", options: yn },
        { type: "radio", name: "C2", text: "I consent voluntarily to take part. I understand that I can refuse to answer questions and stop before I submit, without giving a reason, and that my answers cannot be removed after I submit because they are anonymous.", options: yn },
        { type: "radio", name: "C3", text: "I understand that my answers will be used for a PhD thesis, research publications, a policy summary and possible future research, and that they will be anonymised.", options: yn },
        { type: "radio", name: "C4", text: "I agree that my anonymised answers can be shared in a public research data repository.", options: yn },
        { type: "radio", name: "C5", text: "I understand that my Prolific ID will be kept confidential and used only for payment.", options: yn },
        { type: "radio", name: "C6", text: "I am 18 or over and live in the United States.", options: yn }
      ],
      after: function () {
        var ok = ["C1", "C2", "C3", "C4", "C5", "C6"].every(function (k) { return D[k] === 1; });
        D.consent = ok ? 1 : 0;
        if (!ok) { noConsent(); return "stop"; }
        return assignArm().then(function () { buildMain(); });
      }
    };
  }

  function noConsent() {
    finished = true;
    if (QX && !TEST) {
      QX.done({ rid: D.rid, consent: 0, PROLIFIC_PID: D.PROLIFIC_PID });
      return;
    }
    app.innerHTML = '<div class="panel"><h1>Thank you</h1><p>You have chosen not to take part. None of your answers have been saved. Please return the study on Prolific; you will not be penalised.</p>' +
      '<div class="nav"><button class="next" id="back">Return to Prolific</button></div></div>';
    document.getElementById("back").addEventListener("click", function () {
      if (TEST) { app.innerHTML = '<div class="panel"><p>TEST MODE: would redirect with code ' + C.noConsentCode + '.</p></div>'; return; }
      window.location.href = C.prolificReturn + C.noConsentCode;
    });
  }

  function assignArm() {
    var forced = P.get("arm");
    if (TEST && C.arms.indexOf(forced) >= 0) { D.arm = forced; D.arm_source = "forced"; return Promise.resolve(); }
    if (QX && C.arms.indexOf(QX.arm) >= 0) { D.arm = QX.arm; D.arm_source = "qualtrics"; return Promise.resolve(); }
    if (TEST || !C.datapipeId) {
      D.arm = C.arms[Math.floor(rand() * C.arms.length)]; D.arm_source = "random_local"; return Promise.resolve();
    }
    app.querySelector("#next").textContent = "Loading...";
    return fetch(PIPE + "condition/", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "*/*" },
      body: JSON.stringify({ experimentID: C.datapipeId })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && typeof j.condition === "number") { D.arm = C.arms[j.condition % C.arms.length]; D.arm_source = "datapipe"; D.arm_index = j.condition; }
      else throw new Error("no condition");
    }).catch(function () {
      D.arm = C.arms[Math.floor(rand() * C.arms.length)]; D.arm_source = "random_fallback";
    });
  }

  function buildMain() {
    var arm = D.arm;
    var walletOrder = shuffle(["PFD", "BRD", "ORD"]);
    var coinOrder = shuffle(["PFD", "BRD", "ORD"]);
    var entOrder = shuffle(["PFD", "ORD"]);
    D.wallet_order = walletOrder.join("-");
    D.coin_order = coinOrder.join("-");
    D.ent_order = entOrder.join("-");

    // Pre-treatment trust battery
    var trustRows = shuffle([
      ["tr_bank", "Banks"],
      ["tr_ins", "Insurance companies"],
      ["tr_cc", "Credit card companies"],
      ["tr_adv", "Financial advisors"],
      ["tr_fin", "Payment apps and financial technology companies (for example PayPal, Venmo, Cash App, Chime)"],
      ["tr_bt", "\"Big Tech\" companies (for example Google, Amazon, Apple, Meta)"],
      ["tr_sm", "Social media companies"],
      ["tr_cry", "Cryptocurrency companies"],
      ["tr_gov", "The federal government"],
      ["tr_reg", "Federal financial regulators (government agencies that supervise banks and financial companies)"],
      ["ATT1", "For this row, please select 3 to show that you are reading carefully."]
    ]);
    D.trust_order = trustRows.map(function (r) { return r[0]; }).join("-");
    pages.push({
      id: "pre_trust", rows: true,
      top: '<h1>Trust in organizations</h1><p>In general, how much trust do you have in the following types of organization?</p>',
      items: trustRows.map(function (r) { return s11(r[0], r[1]); })
    });

    pages.push({
      id: "pre_other",
      top: '<h1>About you</h1>',
      items: [
        { type: "scale", name: "OWNBANK", text: "And how much do you trust your own main bank or credit union?", values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          extra: [[98, "I don't have a bank or credit union account"]], left: "0 = No trust at all", right: "10 = Complete trust" },
        { type: "radio", name: "LIT1", text: "Suppose you had $100 in a savings account and the interest rate was 2% per year. After 5 years, how much do you think you would have in the account if you left the money to grow?",
          options: [[1, "More than $102"], [2, "Exactly $102"], [3, "Less than $102"], [8, "Don't know"], [9, "Prefer not to say"]] },
        { type: "radio", name: "LIT2", text: "Imagine that the interest rate on your savings account was 1% per year and inflation was 2% per year. After 1 year, how much would you be able to buy with the money in this account?",
          options: [[1, "More than today"], [2, "Exactly the same"], [3, "Less than today"], [8, "Don't know"], [9, "Prefer not to say"]] },
        { type: "radio", name: "LIT3", text: "Please tell us whether this statement is true or false: Buying a single company's stock usually provides a safer return than a stock mutual fund.",
          options: [[1, "True"], [2, "False"], [8, "Don't know"], [9, "Prefer not to say"]] },
        { type: "radio", name: "CRYPTO12", text: "In the past 12 months, have you owned any cryptocurrency or stablecoins (for example Bitcoin, Ether, USDC, Tether or PayPal USD)?",
          options: [[1, "Yes"], [2, "No"], [3, "Not sure"]] },
        { type: "check", name: "APPS", text: "Which of these have you used to pay or send money in the past 12 months? Select all that apply.",
          options: [["paypal", "PayPal"], ["venmo", "Venmo"], ["cashapp", "Cash App"], ["zelle", "Zelle"], ["apple", "Apple Pay or Apple Cash"],
            ["google", "Google Pay or Google Wallet"], ["crypto", "A crypto wallet or exchange app"], ["none", "None of these", true]] },
        { type: "radio", name: "BANKED", text: "Do you currently have a checking or savings account at a bank or credit union?",
          options: [[1, "Yes"], [2, "No"]] }
      ]
    });

    pages.push({
      id: "intro", button: "Show the app screen",
      top: '<h1>Stablecoins in a wallet app</h1>' +
        '<div class="box"><p><b>What is a stablecoin?</b> A stablecoin is a digital token designed to always be worth one US dollar. You get stablecoins by paying US dollars to the company that issues them, and you can later exchange them back for US dollars at the same rate. This is called redeeming. Stablecoins are recorded on a blockchain, a shared digital record of who holds which coins.</p>' +
        '<p><b>Why do people use them?</b> Stablecoins can be sent at any time of day, including weekends and holidays, and usually arrive within minutes, often at low cost, also to other countries. Some people use them to pay online or to hold US dollars in digital form.</p>' +
        '<p><b>How does it work?</b> In an app, a stablecoin balance works much like money in an account: you can hold it, pay with it, or send it to other people.</p>' +
        '<p><b>How is the $1 value kept?</b> For every coin it issues, the issuer is meant to hold assets of at least the same value, for example cash in bank accounts and short-term US government debt. These assets are called reserves. Whether a coin stays worth $1 depends on the issuer holding these reserves and paying out when people redeem.</p></div>' +
        '<p>Now imagine you use a wallet app on your phone that has a "Digital dollars" tab. It lists three US dollar stablecoins. The coins and companies are made up. Please read the screen as you would in a real app.</p>'
    });

    pages.push({
      id: "wallet",
      top: '<p>Here is the "Digital dollars" tab of the app. Please look at it as you would in a real app. You can take as long as you like.</p>' + walletHTML(walletOrder, arm)
    });

    coinOrder.forEach(function (code, k) {
      var c = COINS[code];
      var beliefs = shuffle([
        ["B1", "If " + c.issuer + " failed, the FDIC would repay " + c.tk + " holders up to $250,000."],
        ["B2", "The U.S. government guarantees that 1 " + c.tk + " can always be exchanged for $1."],
        ["B3", c.art + " " + c.tk + " balance is a bank deposit."],
        ["B4", "If " + c.issuer + " failed, " + c.tk + " holders would be paid from its reserves before its other creditors."],
        ["B5", "The U.S. government stands behind " + c.tk + "."]
      ]);
      D["B_order_" + code] = beliefs.map(function (b) { return b[0]; }).join("-");
      pages.push({
        id: "beliefs_" + code, track: code, rows: true,
        top: '<p class="small">Coin ' + (k + 1) + ' of 3</p>' + cardHTML(code, arm) +
          '<p><b>Based on what you see, how likely is it that each statement is true?</b> There are no right or wrong answers; we want your impression. Please do not look anything up.</p>',
        items: beliefs.map(function (b) {
          return { type: "slider", name: b[0] + "_" + code, text: b[1], showValue: true, left: "0 = Certainly false", mid: "50-50", right: "100 = Certainly true" };
        })
      });
      pages.push({
        id: "trust_" + code, rows: true,
        top: cardHTML(code, arm) + '<p><b>How much do you agree with each statement about the ' + esc(c.name) + ' and the company that issues it, ' + esc(c.issuer) + '?</b></p>',
        items: [
          s7("TR_FA_" + code, c.issuer + " is competent at looking after customers' money."),
          s7("TR_TA_" + code, c.issuer + " is good at building reliable technology and apps."),
          s7("TR_IN_" + code, c.issuer + " would be honest with " + c.tk + " holders."),
          s7("TR_BE_" + code, c.issuer + " would act in the best interest of " + c.tk + " holders."),
          s7("TR_OV_" + code, "Overall, I would trust " + c.tk + " to keep my money safe."),
          { type: "slider", name: "CRIT_" + code, text: "When you judge the " + esc(c.name) + ", which matters more to you?", showValue: false,
            left: "The company's skill with technology and apps", mid: "Both equally", right: "The company's skill and record in looking after people's money" }
        ]
      });
    });

    // Entitativity (adapted from Gong et al., 2020, Appendix F: perceived business tie PBT1-3, perceived similarity PS1-3)
    var ENT = {
      PFD: { reminder: "The Passfield Dollar is issued by Passfield Digital LLC, a subsidiary of Passfield Bank, N.A.",
        items: [
          ["PBT1", "Passfield Bank is connected to Passfield Digital, the issuer of the Passfield Dollar."],
          ["PBT2", "Passfield Bank is likely to recommend the Passfield Dollar to its customers."],
          ["PBT3", "Passfield Bank and Passfield Digital have a business relationship with one another."],
          ["PS1", "The Passfield Dollar has a lot in common with Passfield Bank's services."],
          ["PS2", "The Passfield Dollar and Passfield Bank's services are similar."],
          ["PS3", "Using the Passfield Dollar and using Passfield Bank's services can achieve similar things."]
        ] },
      ORD: { reminder: "The Orbit Dollar is issued by Orbit Pay LLC, a subsidiary of Orbit, a large technology company known for search, devices and cloud services.",
        items: [
          ["PBT1", "Orbit is connected to Orbit Pay, the issuer of the Orbit Dollar."],
          ["PBT2", "Orbit is likely to recommend the Orbit Dollar to its users."],
          ["PBT3", "Orbit and Orbit Pay have a business relationship with one another."],
          ["PS1", "The Orbit Dollar has a lot in common with Orbit's services."],
          ["PS2", "The Orbit Dollar and Orbit's services are similar."],
          ["PS3", "Using the Orbit Dollar and using Orbit's services can achieve similar things."]
        ] }
    };
    entOrder.forEach(function (code, k) {
      var e = ENT[code];
      var items = e.items.map(function (x) { return s7("ENT_" + x[0] + "_" + code, x[1]); });
      if (k === 1) items.push(s7("CF1", "Thinking of all three coins in the app: these three coins are basically the same kind of product."));
      pages.push({
        id: "ent_" + code, rows: true,
        top: '<p class="small">' + esc(e.reminder) + '</p><p><b>How much do you agree with each statement?</b></p>',
        items: items
      });
    });

    // Allocation
    var allocRows = shuffle(["PFD", "BRD", "ORD"]);
    D.alloc_order = allocRows.join("-");
    var rowsHTML = '<tr><td>My FDIC-insured bank account</td><td class="amt">$ <input type="number" inputmode="numeric" min="0" max="1000" step="1" data-alloc="BANK"></td></tr>' +
      allocRows.map(function (code) {
        return '<tr><td>' + esc(COINS[code].name) + ' (' + code + ')</td><td class="amt">$ <input type="number" inputmode="numeric" min="0" max="1000" step="1" data-alloc="' + code + '"></td></tr>';
      }).join("") +
      '<tr class="total"><td>Total</td><td class="amt"><span id="alloc-total">$0</span> of $1,000</td></tr>';
    function allocVals(el) {
      var out = {}, any = false, sum = 0, bad = false;
      el.querySelectorAll("input[data-alloc]").forEach(function (i) {
        var raw = i.value.trim();
        if (raw === "") { out[i.dataset.alloc] = null; return; }
        var v = Number(raw);
        if (!isFinite(v) || v < 0 || Math.round(v) !== v) bad = true;
        out[i.dataset.alloc] = v; any = true; sum += isFinite(v) ? v : 0;
      });
      return { vals: out, any: any, sum: sum, bad: bad };
    }
    pages.push({
      id: "alloc",
      top: '<h1>Your choice</h1>' +
        '<p>Imagine you have $1,000 that you want to keep for everyday spending over the next six months. You can keep it in your FDIC-insured bank account or hold it in any of the three coins. How would you split the $1,000? Enter amounts that add up to $1,000. Any split is fine, including $0 for any option.</p>' +
        '<p class="small hidden" id="unbanked">If you do not have a bank account, imagine that you do.</p>' +
        '<table class="alloc">' + rowsHTML + '</table>',
      onShow: function (el) {
        if (D.BANKED === 2) el.querySelector("#unbanked").classList.remove("hidden");
        var upd = function () {
          var a = allocVals(el), t = el.querySelector("#alloc-total");
          t.textContent = "$" + a.sum.toLocaleString("en-US");
          t.parentNode.parentNode.querySelector(".amt").className = "amt " + (a.any ? (a.sum === 1000 ? "total ok" : "total bad") : "");
        };
        el.querySelectorAll("input[data-alloc]").forEach(function (i) { i.addEventListener("input", upd); });
      },
      validate: function (el) {
        var a = allocVals(el);
        if (!a.any) return null;
        if (a.bad) return "Please enter whole dollar amounts of $0 or more.";
        if (a.sum !== 1000) return "The amounts need to add up to $1,000. They currently add up to $" + a.sum.toLocaleString("en-US") + ".";
        return null;
      },
      countMissing: function (el) { return allocVals(el).any ? 0 : 1; },
      after: function (el) {
        var a = allocVals(el);
        ["BANK", "PFD", "BRD", "ORD"].forEach(function (k) {
          D["HOLD_" + k] = a.any ? (a.vals[k] === null ? 0 : a.vals[k]) : null;
        });
      }
    });

    pages.push({
      id: "checks",
      top: '<h1>About the app screen</h1>',
      items: [
        { type: "radio", name: "MC1", text: "Did the app screen say anything about the coins' federal status?",
          options: [[1, "Yes, that the issuers are federally supervised"], [2, "Yes, that the issuers are not federally supervised"], [3, "No, it said nothing about federal status"], [4, "I don't remember"]] },
        { type: "radio", name: "MC2", text: "Did the app screen say whether the coins are FDIC-insured?",
          options: [[1, "Yes, that they are FDIC-insured"], [2, "Yes, that they are not FDIC-insured"], [3, "No, it said nothing about whether the coins are insured"], [4, "I don't remember"]] },
        { type: "radio", name: "LOOKUP", text: "Did you look up any information while answering, for example online or with an AI assistant? Your answer will not affect your payment.",
          options: [[1, "Yes"], [2, "No"]] }
      ]
    });

    var att = shuffle([
      ["ATT_INNOV", "I enjoy trying new financial apps."],
      ["ATT_SQ", "I prefer to keep my money with institutions I already know."],
      ["ATT2", "I swim across the Atlantic Ocean to get to work every day."]
    ]);
    D.att_order = att.map(function (a) { return a[0]; }).join("-");
    var lastItems = att.map(function (a) { return s6(a[0], a[1]); });
    lastItems.push({ type: "radio", name: "BANKTYPE", text: "What kind of institution is your main bank?",
      options: [[1, "A large national bank"], [2, "A regional or community bank"], [3, "A credit union"], [4, "An online-only bank or app (for example Chime or SoFi)"], [5, "I don't have one"]] });
    if (D.stratum === "pilot" || TEST) lastItems.push({ type: "text", name: "COMMENTS", text: "Was anything in this study unclear? (optional)", optional: true });
    pages.push({
      id: "final", rows: false,
      top: '<h1>A few last questions</h1><p>How much do you agree with each statement?</p>',
      items: lastItems
    });

    pages.push({
      id: "debrief", button: "Finish and return to Prolific",
      top: '<h1>Thank you</h1>' +
        '<p>This study is about whether information shown next to a stablecoin changes what people believe about its protection. You saw one of three versions of the screen. The companies and tokens were made up.</p>' +
        '<p>Under the US GENIUS Act, which takes effect in January 2027:</p><ul>' +
        '<li>Payment stablecoins are <b>not</b> insured by the FDIC, even when the issuer belongs to a bank.</li>' +
        '<li>They are <b>not</b> bank deposits.</li>' +
        '<li>They are <b>not</b> guaranteed by the US government, even when the issuer is approved and supervised by a federal regulator.</li>' +
        '<li>If an approved issuer fails, holders <b>are</b> paid first from its reserves, before its other creditors.</li></ul>' +
        '<p>If you have questions, email ' + C.contactEmail + '. Your answers cannot be removed after you submit, because the research file has no name. Please click the button to save your answers and return to Prolific.</p>',
      after: function () { return finish(); }
    });
  }

  // ---------- finish and save ----------
  var finished = false;
  function derive() {
    D.att1_pass = D.ATT1 === 3 ? 1 : 0;
    D.att2_pass = (D.ATT2 !== null && D.ATT2 !== undefined && D.ATT2 <= 3) ? 1 : 0;
    D.t_end = new Date().toISOString();
    D.t_total_ms = Date.now() - T0;
  }
  function save() {
    var body = JSON.stringify({ experimentID: C.datapipeId, filename: D.rid + ".json", data: JSON.stringify(D) });
    var attempt = function (n) {
      return fetch(PIPE + "data/", { method: "POST", headers: { "Content-Type": "application/json", Accept: "*/*" }, body: body })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.error) throw new Error(String(j.error)); return true; })
        .catch(function (e) {
          if (n >= 4) return false;
          return sleep(1500 * n).then(function () { return attempt(n + 1); });
        });
    };
    return attempt(1);
  }
  function finish() {
    derive();
    finished = true;
    bar.style.width = "100%";
    if (QX && !TEST) {
      app.innerHTML = '<div class="panel"><p>Saving your answers. Please do not close this page...</p></div>';
      QX.done(D);
      return "stop";
    }
    if (TEST) {
      var blob = new Blob([JSON.stringify(D, null, 1)], { type: "application/json" });
      app.innerHTML = '<div class="panel"><div class="testbar">TEST MODE: nothing was sent. Real participants would now be redirected with code ' + C.completeCode + '.</div>' +
        '<p><a id="dl" download="test_' + D.arm + '_' + D.rid + '.json">Download this test record</a></p><pre id="json" style="white-space:pre-wrap;font-size:12px"></pre></div>';
      document.getElementById("dl").href = URL.createObjectURL(blob);
      document.getElementById("json").textContent = JSON.stringify(D, null, 1);
      window.RTI_DATA = D;
      return "stop";
    }
    app.innerHTML = '<div class="panel"><p>Saving your answers. Please do not close this page...</p></div>';
    try { localStorage.setItem("rti_" + D.rid, JSON.stringify(D)); } catch (e) { /* storage may be blocked */ }
    var go = function () { window.location.href = C.prolificReturn + C.completeCode; };
    if (!C.datapipeId) { go(); return "stop"; }
    save().then(function (ok) {
      if (ok) { try { localStorage.removeItem("rti_" + D.rid); } catch (e) { /* ignore */ } go(); return; }
      app.innerHTML = '<div class="panel"><p>We could not save your answers automatically. You will still be paid. Please click below to return to Prolific, and message the researcher through Prolific so we know.</p>' +
        '<div class="nav"><button class="next" id="ret">Return to Prolific</button></div></div>';
      document.getElementById("ret").addEventListener("click", go);
    });
    return "stop";
  }

  window.addEventListener("beforeunload", function (e) {
    if (finished || TEST || QX || idx === 0) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // ---------- start ----------
  var T0 = Date.now();
  if (!TEST && !QX && !C.datapipeId) {
    app.innerHTML = '<div class="panel"><h1>Not open yet</h1><p>This study is not open yet. Please return it on Prolific; you will not be penalised.</p></div>';
    return;
  }
  pages.push(consentPage());
  render();
})();
