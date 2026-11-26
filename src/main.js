/**
 * 入口：画布、主循环、场景切换、提示、演示广告。
 */
var CONFIG = require('./config');
var Platform = require('./platform');
var Economy = require('./economy');
var Sound = require('./audio');
var Ads = require('./ads');
var UI = require('./ui');
var T = UI.T;
var MenuScene = require('./scenes/menu');
var PlayScene = require('./scenes/play');

var Main = {
  platform: Platform,
  ctx: null,
  W: 0,
  H: 0,
  dpr: 1,
  scene: null,
  lastTs: 0,
  fade: 0,
  fadeDir: 0,
  pendingScene: null,
  toast: { text: '', color: T.ink, life: 0, ttl: 1.8 },
  adOverlay: null,
  adBtn: null,
  adSkip: null,
  started: false,

  boot: function () {
    var self = this;
    Economy.init();
    Sound.setMuted(!Economy.s.settings.sound);

    Platform.init({
      start: function (p) { self.onDown(p); },
      move: function (p) { self.onMove(p); },
      end: function (p) { self.onUp(p); }
    });
    this.ctx = Platform.ctx;
    this.W = Platform.W;
    this.H = Platform.H;
    this.dpr = Platform.dpr;

    Platform.onResize = function () {
      self.W = Platform.W;
      self.H = Platform.H;
      self.dpr = Platform.dpr;
      if (self.scene && self.scene.layout) self.scene.layout();
    };

    Ads.init({
      simRewarded: function (seconds, onDone, onAbort) {
        self.startSimAd('rewarded', seconds, onDone, onAbort);
      },
      simInterstitial: function (seconds, onDone, onAbort) {
        self.startSimAd('interstitial', seconds, onDone, onAbort);
      }
    });

    Platform.onHide(function () {
      Economy.save();
      if (self.scene && self.scene.onHide) self.scene.onHide();
    });
    Platform.onShow(function () {
      Economy.updateIdle();
    });

    if (!Platform.isWx) {
      window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.scene && self.scene.onEscape) self.scene.onEscape();
      });
    }

    this.scene = new MenuScene(this);
    if (this.scene.enter) this.scene.enter();

    this.started = true;
    this.lastTs = 0;
    Platform.raf(function (ts) { self.frame(ts); });
  },

  frame: function (ts) {
    var self = this;
    var now = ts || Platform.now();
    if (!this.lastTs) this.lastTs = now;
    var dt = Math.min(0.05, Math.max(0, (now - this.lastTs) / 1000));
    this.lastTs = now;
    this.update(dt);
    this.render();
    Platform.raf(function (t) { self.frame(t); });
  },

  update: function (dt) {
    if (this.toast.life > 0) this.toast.life -= dt;

    if (this.fadeDir === 1) {
      this.fade += dt * 5.5;
      if (this.fade >= 1) {
        this.fade = 1;
        if (this.pendingScene) {
          this.scene = this.pendingScene;
          this.pendingScene = null;
          if (this.scene.enter) this.scene.enter();
        }
        this.fadeDir = -1;
      }
    } else if (this.fadeDir === -1) {
      this.fade -= dt * 5.5;
      if (this.fade <= 0) {
        this.fade = 0;
        this.fadeDir = 0;
      }
    }

    if (this.adOverlay) {
      var ad = this.adOverlay;
      if (ad.state === 'playing') {
        ad.left -= dt;
        if (ad.left <= 0) {
          ad.left = 0;
          ad.state = 'done';
        }
      }
      ad.t += dt;
    }

    if (this.scene && this.scene.update) this.scene.update(dt);
  },

  render: function () {
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.scene && this.scene.render) this.scene.render(ctx);
    if (this.adOverlay) this.renderSimAd(ctx);
    this.renderToast(ctx);
    if (this.fade > 0) {
      ctx.fillStyle = 'rgba(29,19,12,' + this.fade + ')';
      ctx.fillRect(0, 0, this.W, this.H);
    }
  },

  switchScene: function (scene, instant) {
    if (instant) {
      this.scene = scene;
      if (scene.enter) scene.enter();
      return;
    }
    this.pendingScene = scene;
    this.fadeDir = 1;
    this.fade = Math.max(this.fade, 0.01);
  },

  startOrder: function () {
    if (this.fadeDir !== 0) return;
    Ads.hideBanner();
    this.switchScene(new PlayScene(this));
  },

  toMenu: function () {
    if (this.fadeDir !== 0) return;
    this.switchScene(new MenuScene(this));
  },

  onDown: function (p) {
    if (!this.started) return;
    Sound.init();
    Sound.resume();
    if (this.adOverlay) { this.onAdDown(p); return; }
    if (this.fadeDir !== 0) return;
    if (this.scene && this.scene.onDown) this.scene.onDown(p);
  },

  onMove: function (p) {
    if (this.adOverlay || this.fadeDir !== 0) return;
    if (this.scene && this.scene.onMove) this.scene.onMove(p);
  },

  onUp: function (p) {
    if (this.adOverlay) { this.onAdUp(p); return; }
    if (this.fadeDir !== 0) return;
    if (this.scene && this.scene.onUp) this.scene.onUp(p);
  },

  notify: function (text, color) {
    this.toast.text = text;
    this.toast.color = color || T.ink;
    this.toast.life = this.toast.ttl;
  },

  renderToast: function (ctx) {
    if (this.toast.life <= 0) return;
    var k = Math.min(1, (this.toast.ttl - this.toast.life) * 5);
    var a = Math.min(1, this.toast.life * 2.5);
    var size = 15;
    var w = UI.measure(ctx, this.toast.text, size, 700) + 34;
    var x = (this.W - w) / 2;
    var y = Platform.safeTop + 84;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - k) * -10);
    UI.fillRR(ctx, x, y, w, 38, 19, 'rgba(58,34,16,0.92)');
    UI.text(ctx, this.toast.text, this.W / 2, y + 19, size, '#FFF4DC', 'center', 700);
    ctx.restore();
  },

  rewarded: function (placement, onReward) {
    var self = this;
    Ads.showRewarded(placement, function () {
      Sound.reward();
      onReward();
    }, function () {
      self.notify('广告未完成，奖励没有发放');
    });
  },

  maybeInterstitial: function (after) {
    var s = Economy.s;
    if (s.ordersDone < CONFIG.ads.firstOrdersWithoutInterstitial) { after(); return; }
    if (s.ordersDone % CONFIG.ads.interstitialEveryOrders !== 0) { after(); return; }
    if (Platform.now() - (s.ad.lastInterstitial || 0) < CONFIG.ads.interstitialCooldownMs) { after(); return; }
    var self = this;
    Ads.showInterstitial('result_next', function () {
      Economy.markInterstitial();
      after();
    });
  },

  shareGame: function () {
    var ok = Platform.share('土豆削削乐｜拇指削皮，越削越上头', '来比比谁削得薄，浪费得少！', 'from=share');
    if (!ok) this.notify('请点击右上角「···」分享给好友');
    Platform.reportEvent('share_click', { ok: ok ? 1 : 0 });
  },

  // ---------- 演示广告 ----------
  startSimAd: function (kind, seconds, onDone, onAbort) {
    this.adOverlay = {
      kind: kind,
      total: seconds,
      left: seconds,
      state: 'playing',
      t: 0,
      onDone: onDone,
      onAbort: onAbort
    };
    this.adBtn = null;
    this.adSkip = null;
    Platform.reportEvent('ad_show_demo', { kind: kind });
  },

  finishSimAd: function (completed) {
    if (!this.adOverlay) return;
    var ad = this.adOverlay;
    this.adOverlay = null;
    this.adBtn = null;
    this.adSkip = null;
    if (ad.kind === 'rewarded') {
      if (completed) { if (ad.onDone) ad.onDone(); }
      else { if (ad.onAbort) ad.onAbort('skip'); }
    } else {
      if (ad.onDone) ad.onDone();
    }
  },

  renderSimAd: function (ctx) {
    var ad = this.adOverlay;
    var W = this.W;
    var H = this.H;
    UI.dim(ctx, W, H, 0.78);
    var cw = Math.min(W - 48, 370);
    var ch = Math.min(430, H - 140);
    var cx = (W - cw) / 2;
    var cy = (H - ch) / 2;

    ctx.save();
    UI.shadow(ctx, 'rgba(0,0,0,0.45)', 30, 0, 12);
    UI.fillRR(ctx, cx, cy, cw, ch, 24, '#FFF7E6');
    UI.clearShadow(ctx);

    // 顶部广告标识
    UI.pill(ctx, cx + 14, cy + 14, 96, 26, 'rgba(74,46,25,0.1)');
    UI.drawIcon(ctx, 'video', cx + 28, cy + 27, 14, T.inkSoft);
    UI.text(ctx, '演示广告', cx + 40, cy + 27, 12, T.inkSoft, 'left', 700);
    if (ad.state !== 'playing') {
      UI.text(ctx, ad.kind === 'rewarded' ? '激励视频' : '插屏广告', cx + cw - 16, cy + 27, 12, T.inkSoft, 'right', 700);
    }

    // 广告画面
    var ax = cx + 16;
    var ay = cy + 50;
    var aw = cw - 32;
    var ah = ch - 172;
    var g = ctx.createLinearGradient(ax, ay, ax, ay + ah);
    g.addColorStop(0, '#F9E7C4');
    g.addColorStop(1, '#E9C98E');
    UI.fillRR(ctx, ax, ay, aw, ah, 18, g);

    // 装饰土豆
    var pcx = ax + aw / 2;
    var pcy = ay + ah * 0.44;
    var pr = Math.min(aw * 0.24, ah * 0.32);
    ctx.save();
    ctx.translate(pcx, pcy);
    ctx.scale(1.12, 0.94);
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.fillStyle = '#B0743E';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-pr * 0.36, -pr * 0.34, pr * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,235,190,0.5)';
    ctx.fill();
    // 削开的一块
    ctx.beginPath();
    ctx.arc(pr * 0.18, pr * 0.2, pr * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = '#F8E6B4';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-pr * 0.12, -pr * 0.16, pr * 0.07, 0, Math.PI * 2);
    ctx.arc(pr * 0.22, -pr * 0.16, pr * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = '#4A2E19';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pr * 0.05, pr * 0.02, pr * 0.12, 0.2, Math.PI - 0.2);
    ctx.strokeStyle = '#4A2E19';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    UI.text(ctx, ad.kind === 'rewarded' ? '军需处补给提醒' : '削土豆也要休息一下', ax + aw / 2, ay + 28, 15, '#7E5A38', 'center', 800);
    UI.text(ctx, '土豆削削乐 · 看广告得土豆币', ax + aw / 2, ay + ah - 24, 12, 'rgba(94,58,28,0.75)', 'center', 600);

    // 倒计时
    if (ad.state === 'playing') {
      var sec = Math.ceil(ad.left);
      ctx.beginPath();
      ctx.arc(cx + cw / 2, cy + ch - 84, 22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(74,46,25,0.08)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + cw / 2, cy + ch - 84, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - ad.left / ad.total));
      ctx.strokeStyle = T.green;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
      UI.text(ctx, String(sec), cx + cw / 2, cy + ch - 84, 18, T.ink, 'center', 800);
      UI.text(ctx, '广告播放中…', cx + cw / 2, cy + ch - 46, 13, T.inkSoft, 'center', 600);

      // 跳过
      var skx = cx + cw - 30;
      var sky = cy + 27;
      UI.text(ctx, '跳过', skx - 12, sky + 1, 12, T.inkSoft, 'right', 700);
      this.adSkip = { x: cx + cw - 74, y: cy + 10, w: 64, h: 34 };
    } else {
      var bw = Math.min(220, cw - 60);
      var bx = cx + (cw - bw) / 2;
      var by = cy + ch - 108;
      var btn = UI.makeButton({
        x: bx, y: by, w: bw, h: 50, radius: 16,
        label: ad.kind === 'rewarded' ? '领取奖励' : '关闭广告',
        kind: ad.kind === 'rewarded' ? 'primary' : 'secondary',
        size: 17
      });
      UI.button(ctx, btn);
      this.adBtn = btn;
      if (ad.kind === 'rewarded') {
        UI.text(ctx, '完整观看后奖励自动到账', cx + cw / 2, cy + ch - 38, 12, T.inkSoft, 'center', 600);
      }
    }

    ctx.restore();
  },

  onAdDown: function (p) {
    var ad = this.adOverlay;
    if (!ad) return;
    if (ad.state === 'done' && this.adBtn && UI.hit(this.adBtn, p.x, p.y)) {
      this.adBtn.pressed = true;
    } else if (ad.state === 'playing' && this.adSkip && UI.hit(this.adSkip, p.x, p.y)) {
      this.adSkip.pressed = true;
    }
  },

  onAdUp: function (p) {
    var ad = this.adOverlay;
    if (!ad) return;
    if (ad.state === 'done' && this.adBtn && UI.hit(this.adBtn, p.x, p.y)) {
      this.adBtn.pressed = false;
      this.finishSimAd(true);
      return;
    }
    if (ad.state === 'playing' && this.adSkip && UI.hit(this.adSkip, p.x, p.y)) {
      this.adSkip.pressed = false;
      this.finishSimAd(false);
      return;
    }
    if (this.adBtn) this.adBtn.pressed = false;
    if (this.adSkip) this.adSkip.pressed = false;
  }
};

Main.boot();
