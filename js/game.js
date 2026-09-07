(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const FLOOR = 448;

  const menu = document.getElementById("menu");
  const help = document.getElementById("help");
  const roundPanel = document.getElementById("roundPanel");
  const roundMessage = document.getElementById("roundMessage");
  const continueRound = document.getElementById("continueRound");
  const pauseButton = document.getElementById("pauseButton");

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
    }

    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx?.state === "suspended") this.ctx.resume();
    }

    tone(freq, duration = 0.08, type = "square", volume = 0.045, slide = 0) {
      if (!this.enabled) return;
      this.unlock();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    }

    hit(heavy = false) {
      this.tone(heavy ? 90 : 150, heavy ? 0.13 : 0.07, "sawtooth", heavy ? 0.08 : 0.05, -40);
    }

    jump() { this.tone(260, 0.09, "square", 0.035, 120); }
    special() { this.tone(210, 0.26, "sawtooth", 0.055, 420); }
    ko() { this.tone(120, 0.55, "sawtooth", 0.08, -80); }
  }

  class InputManager {
    constructor() {
      this.keys = new Set();
      this.pressed = new Set();
      this.touch = new Set();
      this.touchPressed = new Set();

      window.addEventListener("keydown", (e) => {
        const key = e.key.toLowerCase();
        if (!this.keys.has(key)) this.pressed.add(key);
        this.keys.add(key);
        if (["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(key)) {
          e.preventDefault();
        }
        if (key === "escape") game.togglePause();
      }, { passive: false });

      window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
      window.addEventListener("blur", () => {
        this.keys.clear();
        this.touch.clear();
      });

      document.querySelectorAll("[data-input]").forEach((button) => {
        const action = button.dataset.input;
        const down = (e) => {
          e.preventDefault();
          audio.unlock();
          if (!this.touch.has(action)) this.touchPressed.add(action);
          this.touch.add(action);
          button.classList.add("active");
          button.setPointerCapture?.(e.pointerId);
        };
        const up = (e) => {
          e.preventDefault();
          this.touch.delete(action);
          button.classList.remove("active");
        };
        button.addEventListener("pointerdown", down);
        button.addEventListener("pointerup", up);
        button.addEventListener("pointercancel", up);
        button.addEventListener("pointerleave", up);
      });
    }

    held(key) { return this.keys.has(key) || this.touch.has(key); }
    tap(key) { return this.pressed.has(key) || this.touchPressed.has(key); }

    endFrame() {
      this.pressed.clear();
      this.touchPressed.clear();
    }
  }

  const ATTACKS = {
    light: {
      duration: 0.26,
      activeStart: 0.075,
      activeEnd: 0.16,
      damage: 6,
      range: 70,
      height: 42,
      yOffset: 26,
      cooldown: 0.17,
      knockback: 150,
      hitstun: 0.18,
      energyGain: 8
    },
    heavy: {
      duration: 0.46,
      activeStart: 0.15,
      activeEnd: 0.28,
      damage: 12,
      range: 89,
      height: 52,
      yOffset: 32,
      cooldown: 0.29,
      knockback: 265,
      hitstun: 0.34,
      energyGain: 12
    },
    special: {
      duration: 0.6,
      activeStart: 0.2,
      activeEnd: 0.24,
      damage: 14,
      range: 0,
      height: 0,
      yOffset: 0,
      cooldown: 0.45,
      knockback: 210,
      hitstun: 0.3,
      cost: 40
    }
  };

  class Fighter {
    constructor(options) {
      Object.assign(this, options);
      this.w = 58;
      this.h = 110;
      this.roundWins = 0;
      this.reset(options.x);
    }

    reset(x) {
      this.x = x;
      this.y = FLOOR - this.h;
      this.vx = 0;
      this.vy = 0;
      this.health = 100;
      this.energy = 0;
      this.facing = this.side === 1 ? 1 : -1;
      this.attack = null;
      this.attackTime = 0;
      this.attackHit = false;
      this.cooldown = 0;
      this.hitstun = 0;
      this.blocking = false;
      this.grounded = true;
      this.flash = 0;
      this.aiTimer = 0;
      this.aiIntent = {};
      this.ko = false;
    }

    get centerX() { return this.x + this.w / 2; }
    get centerY() { return this.y + this.h / 2; }

    attackStart(type, game) {
      if (this.attack || this.cooldown > 0 || this.hitstun > 0 || this.ko) return;
      const data = ATTACKS[type];
      if (type === "special" && this.energy < data.cost) return;

      this.attack = type;
      this.attackTime = 0;
      this.attackHit = false;
      this.vx *= 0.42;
      if (type === "special") {
        this.energy -= data.cost;
        audio.special();
        game.addBurst(this.centerX + this.facing * 30, this.centerY, this.accent, 20);
      }
    }

    jump() {
      if (!this.grounded || this.attack || this.hitstun > 0 || this.ko) return;
      this.vy = -610;
      this.grounded = false;
      audio.jump();
    }

    takeHit(damage, knockback, hitstun, attacker, game, isHeavy = false) {
      if (this.ko) return;
      const blocked = this.blocking && this.grounded && Math.sign(attacker.centerX - this.centerX) === this.facing;
      const finalDamage = blocked ? Math.max(1, damage * 0.22) : damage;

      this.health = clamp(this.health - finalDamage, 0, 100);
      this.flash = 0.12;
      this.attack = null;
      this.cooldown = 0.08;

      if (blocked) {
        this.hitstun = 0.08;
        this.vx = attacker.facing * knockback * 0.18;
        game.addBlockSpark((this.centerX + attacker.centerX) / 2, this.centerY - 10);
        audio.tone(480, 0.05, "square", 0.035, -180);
      } else {
        this.hitstun = hitstun;
        this.vx = attacker.facing * knockback;
        this.vy = isHeavy ? -130 : this.vy;
        this.energy = clamp(this.energy + 8, 0, 100);
        game.addHitSpark((this.centerX + attacker.centerX) / 2, this.centerY - 8, isHeavy);
        game.shake = isHeavy ? 10 : 5;
        audio.hit(isHeavy);
      }

      if (this.health <= 0) {
        this.ko = true;
        this.hitstun = 1.2;
        this.vx = attacker.facing * 420;
        this.vy = -320;
        audio.ko();
      }
    }

    update(dt, opponent, game) {
      this.flash = Math.max(0, this.flash - dt);
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.hitstun = Math.max(0, this.hitstun - dt);

      if (!this.ko) this.facing = opponent.centerX >= this.centerX ? 1 : -1;

      let controls = this.ai ? this.getAI(dt, opponent, game) : this.getHumanControls();
      if (game.state !== "playing") controls = {};

      this.blocking = !!controls.block && !this.attack && this.grounded && this.hitstun <= 0 && !this.ko;

      if (this.hitstun <= 0 && !this.ko) {
        const speed = this.blocking ? 70 : 235;
        if (!this.attack) {
          const dir = (controls.left ? -1 : 0) + (controls.right ? 1 : 0);
          this.vx = lerp(this.vx, dir * speed, Math.min(1, dt * 12));
          if (controls.jump) this.jump();
          if (controls.light) this.attackStart("light", game);
          else if (controls.heavy) this.attackStart("heavy", game);
          else if (controls.special) this.attackStart("special", game);
        }
      }

      if (this.attack) {
        const data = ATTACKS[this.attack];
        this.attackTime += dt;

        if (this.attack === "special" &&
            this.attackTime >= data.activeStart &&
            !this.attackHit) {
          this.attackHit = true;
          game.spawnProjectile(this);
        }

        if (this.attack !== "special" &&
            this.attackTime >= data.activeStart &&
            this.attackTime <= data.activeEnd &&
            !this.attackHit) {
          const hitbox = this.getAttackHitbox(data);
          if (rectsOverlap(hitbox, opponent.getHurtbox())) {
            this.attackHit = true;
            this.energy = clamp(this.energy + data.energyGain, 0, 100);
            opponent.takeHit(
              data.damage,
              data.knockback,
              data.hitstun,
              this,
              game,
              this.attack === "heavy"
            );
          }
        }

        if (this.attackTime >= data.duration) {
          this.cooldown = data.cooldown;
          this.attack = null;
          this.attackTime = 0;
        }
      }

      if (!this.grounded) this.vy += 1450 * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      if (this.y + this.h >= FLOOR) {
        this.y = FLOOR - this.h;
        this.vy = 0;
        this.grounded = true;
      }

      if (this.grounded && !this.attack && this.hitstun <= 0) {
        this.vx *= Math.pow(0.0009, dt);
      } else {
        this.vx *= Math.pow(0.08, dt);
      }

      this.x = clamp(this.x, 26, W - this.w - 26);
    }

    getHumanControls() {
      if (this.side === 1) {
        return {
          left: input.held("a") || input.held("left"),
          right: input.held("d") || input.held("right"),
          jump: input.tap("w") || input.tap("jump"),
          block: input.held("s") || input.held("block"),
          light: input.tap("f") || input.tap("light"),
          heavy: input.tap("g") || input.tap("heavy"),
          special: input.tap("h") || input.tap("special")
        };
      }
      return {
        left: input.held("arrowleft"),
        right: input.held("arrowright"),
        jump: input.tap("arrowup"),
        block: input.held("arrowdown"),
        light: input.tap("j"),
        heavy: input.tap("k"),
        special: input.tap("l")
      };
    }

    getAI(dt, opponent, game) {
      this.aiTimer -= dt;
      const distance = Math.abs(opponent.centerX - this.centerX);

      if (this.aiTimer <= 0) {
        this.aiTimer = rand(0.08, 0.2);
        this.aiIntent = {};

        const danger = opponent.attack &&
          opponent.attackTime > ATTACKS[opponent.attack].activeStart * 0.55 &&
          distance < 120;

        if (danger && Math.random() < 0.68) {
          this.aiIntent.block = true;
          this.aiTimer = rand(0.12, 0.28);
        } else if (distance > 150) {
          this.aiIntent[opponent.centerX < this.centerX ? "left" : "right"] = true;
          if (this.energy >= 40 && distance > 250 && Math.random() < 0.16) {
            this.aiIntent.special = true;
          }
        } else if (distance < 62) {
          this.aiIntent[opponent.centerX < this.centerX ? "right" : "left"] = true;
        } else {
          const roll = Math.random();
          if (roll < 0.48) this.aiIntent.light = true;
          else if (roll < 0.73) this.aiIntent.heavy = true;
          else if (roll < 0.82 && this.energy >= 40) this.aiIntent.special = true;
          else if (roll < 0.9) this.aiIntent.jump = true;
          else this.aiIntent.block = true;
        }
      }

      return this.aiIntent;
    }

    getAttackHitbox(data) {
      return {
        x: this.facing === 1 ? this.x + this.w - 6 : this.x - data.range + 6,
        y: this.y + data.yOffset,
        w: data.range,
        h: data.height
      };
    }

    getHurtbox() {
      return { x: this.x + 7, y: this.y + 5, w: this.w - 14, h: this.h - 5 };
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.centerX, this.y);
      ctx.scale(this.facing, 1);

      const t = performance.now() * 0.004 + this.side;
      const bob = this.grounded && !this.attack ? Math.sin(t) * 2 : 0;
      ctx.translate(0, bob);

      if (this.flash > 0) {
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 22;
      }

      const body = this.flash > 0 ? "#ffffff" : this.color;
      const accent = this.flash > 0 ? "#ffffff" : this.accent;

      ctx.globalAlpha = this.blocking ? 0.78 : 1;

      // Legs
      ctx.lineCap = "round";
      ctx.lineWidth = 14;
      ctx.strokeStyle = body;
      ctx.beginPath();
      ctx.moveTo(-12, 72);
      ctx.lineTo(-17, 103);
      ctx.moveTo(12, 72);
      ctx.lineTo(18, 103);
      ctx.stroke();

      // Torso
      ctx.fillStyle = body;
      roundRect(ctx, -23, 30, 46, 52, 11);
      ctx.fill();

      // Belt / core
      ctx.fillStyle = accent;
      roundRect(ctx, -24, 66, 48, 10, 5);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 71, 7, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, 17, 19, 0, Math.PI * 2);
      ctx.fill();

      // Visor
      ctx.fillStyle = "#07101f";
      roundRect(ctx, 2, 9, 17, 8, 4);
      ctx.fill();
      ctx.fillStyle = accent;
      roundRect(ctx, 7, 11, 10, 3, 2);
      ctx.fill();

      // Arms and attack animation
      let frontX = 22;
      let frontY = 47;
      let backX = -22;
      let backY = 50;

      if (this.attack === "light") {
        const p = clamp(this.attackTime / ATTACKS.light.activeEnd, 0, 1);
        frontX = lerp(23, 57, Math.sin(p * Math.PI / 2));
        frontY = 43;
      } else if (this.attack === "heavy") {
        const p = clamp(this.attackTime / ATTACKS.heavy.activeEnd, 0, 1);
        frontX = lerp(20, 68, Math.sin(p * Math.PI / 2));
        frontY = lerp(58, 30, p);
      } else if (this.attack === "special") {
        frontX = 42;
        frontY = 43;
        backX = 26;
        backY = 54;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.globalAlpha = .55;
        ctx.beginPath();
        ctx.arc(43, 43, 18 + Math.sin(t * 2) * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (this.blocking) {
        frontX = 28;
        frontY = 28;
        backX = 22;
        backY = 55;
        ctx.fillStyle = "rgba(255,255,255,.08)";
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(29, 43, 34, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
      }

      ctx.lineWidth = 13;
      ctx.strokeStyle = body;
      ctx.beginPath();
      ctx.moveTo(17, 39);
      ctx.lineTo(frontX, frontY);
      ctx.moveTo(-17, 40);
      ctx.lineTo(backX, backY);
      ctx.stroke();

      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(frontX, frontY, 8, 0, Math.PI * 2);
      ctx.arc(backX, backY, 8, 0, Math.PI * 2);
      ctx.fill();

      // Name emblem
      ctx.fillStyle = "#07101f";
      ctx.font = "900 13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(this.side === 1 ? "V" : "N", 0, 59);

      ctx.restore();
    }
  }

  class Projectile {
    constructor(owner) {
      this.owner = owner;
      this.x = owner.centerX + owner.facing * 50;
      this.y = owner.y + 48;
      this.vx = owner.facing * 510;
      this.radius = 18;
      this.life = 1.4;
      this.dead = false;
      this.hit = false;
    }

    update(dt, opponent, game) {
      this.x += this.vx * dt;
      this.life -= dt;
      if (this.life <= 0 || this.x < -30 || this.x > W + 30) this.dead = true;

      if (!this.hit && circleRectOverlap(this.x, this.y, this.radius, opponent.getHurtbox())) {
        this.hit = true;
        this.dead = true;
        opponent.takeHit(
          ATTACKS.special.damage,
          ATTACKS.special.knockback,
          ATTACKS.special.hitstun,
          this.owner,
          game,
          true
        );
        game.addBurst(this.x, this.y, this.owner.accent, 28);
      }
    }

    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      const pulse = 1 + Math.sin(performance.now() * .014) * .12;
      ctx.scale(pulse, pulse);
      ctx.shadowColor = this.owner.accent;
      ctx.shadowBlur = 22;
      const gradient = ctx.createRadialGradient(-5, -5, 2, 0, 0, this.radius);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(.25, this.owner.accent);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * 1.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = this.owner.accent;
      ctx.lineWidth = 3;
      ctx.globalAlpha = .5;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  class Particle {
    constructor(x, y, color, options = {}) {
      this.x = x;
      this.y = y;
      this.vx = options.vx ?? rand(-260, 260);
      this.vy = options.vy ?? rand(-260, 100);
      this.life = options.life ?? rand(.2, .5);
      this.maxLife = this.life;
      this.size = options.size ?? rand(2, 7);
      this.color = color;
      this.gravity = options.gravity ?? 600;
    }

    update(dt) {
      this.life -= dt;
      this.vy += this.gravity * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    draw(ctx) {
      ctx.globalAlpha = clamp(this.life / this.maxLife, 0, 1);
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x, this.y, this.size, this.size);
      ctx.globalAlpha = 1;
    }
  }

  class Game {
    constructor() {
      this.state = "menu";
      this.mode = "cpu";
      this.round = 1;
      this.roundTimer = 60;
      this.roundEndTimer = 0;
      this.shake = 0;
      this.projectiles = [];
      this.particles = [];
      this.lastTime = performance.now();
      this.announcer = "";
      this.announcerTimer = 0;
      this.stars = Array.from({ length: 70 }, () => ({
        x: rand(0, W),
        y: rand(0, 310),
        s: rand(.5, 2.2),
        p: rand(0, Math.PI * 2)
      }));

      this.p1 = new Fighter({
        side: 1,
        x: 170,
        name: "VOLT",
        color: "#4cebe3",
        accent: "#d6ff50",
        ai: false
      });

      this.p2 = new Fighter({
        side: 2,
        x: 730,
        name: "NOVA",
        color: "#ff4f9a",
        accent: "#ffd957",
        ai: true
      });
    }

    start(mode) {
      audio.unlock();
      this.mode = mode;
      this.p2.ai = mode === "cpu";
      this.p1.roundWins = 0;
      this.p2.roundWins = 0;
      this.round = 1;
      this.resetRound();
      menu.classList.add("hidden");
      help.classList.add("hidden");
      roundPanel.classList.add("hidden");
      this.state = "playing";
      this.announce("ROUND 1", 1.2);
    }

    resetRound() {
      this.p1.reset(170);
      this.p2.reset(730);
      this.projectiles = [];
      this.particles = [];
      this.roundTimer = 60;
      this.roundEndTimer = 0;
      this.shake = 0;
    }

    togglePause() {
      if (this.state === "playing") {
        this.state = "paused";
        roundMessage.textContent = "PAUSA";
        continueRound.textContent = "Continuar";
        roundPanel.classList.remove("hidden");
      } else if (this.state === "paused") {
        this.state = "playing";
        roundPanel.classList.add("hidden");
      }
    }

    spawnProjectile(owner) {
      this.projectiles.push(new Projectile(owner));
    }

    announce(text, duration = 1) {
      this.announcer = text;
      this.announcerTimer = duration;
    }

    addHitSpark(x, y, heavy) {
      const colors = heavy ? ["#ffffff", "#ffda57", "#ff4f9a"] : ["#ffffff", "#42e8e0"];
      const amount = heavy ? 24 : 12;
      for (let i = 0; i < amount; i++) {
        this.particles.push(new Particle(x, y, colors[i % colors.length], {
          life: rand(.16, .42),
          size: rand(2, heavy ? 8 : 5)
        }));
      }
    }

    addBlockSpark(x, y) {
      for (let i = 0; i < 10; i++) {
        this.particles.push(new Particle(x, y, "#9defff", {
          vx: rand(-120, 120),
          vy: rand(-180, -40),
          life: rand(.12, .3),
          size: rand(2, 4)
        }));
      }
    }

    addBurst(x, y, color, amount = 20) {
      for (let i = 0; i < amount; i++) {
        const angle = (Math.PI * 2 * i) / amount + rand(-.15, .15);
        const speed = rand(120, 360);
        this.particles.push(new Particle(x, y, color, {
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          gravity: 80,
          life: rand(.2, .55),
          size: rand(2, 6)
        }));
      }
    }

    endRound(winner) {
      if (this.state !== "playing") return;
      this.state = "roundover";
      winner.roundWins++;
      this.announce("K.O.", 1.1);

      const matchOver = winner.roundWins >= 2;
      setTimeout(() => {
        roundMessage.textContent = matchOver
          ? `${winner.name} GANA`
          : `${winner.name} GANA EL ROUND`;
        continueRound.textContent = matchOver ? "Revancha" : "Siguiente round";
        roundPanel.classList.remove("hidden");
        roundPanel.dataset.matchOver = matchOver ? "1" : "0";
      }, 850);
    }

    continue() {
      if (this.state === "paused") {
        this.togglePause();
        return;
      }

      if (roundPanel.dataset.matchOver === "1") {
        this.start(this.mode);
        return;
      }

      this.round++;
      this.resetRound();
      this.state = "playing";
      roundPanel.classList.add("hidden");
      this.announce(`ROUND ${this.round}`, 1.2);
    }

    update(dt) {
      if (this.announcerTimer > 0) this.announcerTimer -= dt;
      this.shake = Math.max(0, this.shake - dt * 38);

      if (this.state !== "playing") {
        input.endFrame();
        return;
      }

      this.roundTimer = Math.max(0, this.roundTimer - dt);
      this.p1.update(dt, this.p2, this);
      this.p2.update(dt, this.p1, this);

      // Prevent fighter overlap.
      const overlap = Math.min(this.p1.x + this.p1.w, this.p2.x + this.p2.w) -
                      Math.max(this.p1.x, this.p2.x);
      if (overlap > 0 && Math.abs(this.p1.centerX - this.p2.centerX) < 70) {
        const push = overlap * .55;
        if (this.p1.centerX < this.p2.centerX) {
          this.p1.x -= push;
          this.p2.x += push;
        } else {
          this.p1.x += push;
          this.p2.x -= push;
        }
      }

      for (const projectile of this.projectiles) {
        const opponent = projectile.owner === this.p1 ? this.p2 : this.p1;
        projectile.update(dt, opponent, this);
      }
      this.projectiles = this.projectiles.filter(p => !p.dead);

      for (const particle of this.particles) particle.update(dt);
      this.particles = this.particles.filter(p => p.life > 0);

      if (this.p1.health <= 0) this.endRound(this.p2);
      else if (this.p2.health <= 0) this.endRound(this.p1);
      else if (this.roundTimer <= 0) {
        if (this.p1.health === this.p2.health) {
          this.p1.health += .01; // deterministic tiebreaker
        }
        this.endRound(this.p1.health > this.p2.health ? this.p1 : this.p2);
      }

      input.endFrame();
    }

    draw() {
      ctx.clearRect(0, 0, W, H);

      ctx.save();
      if (this.shake > 0) {
        ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
      }

      this.drawBackground();
      this.drawArena();

      for (const projectile of this.projectiles) projectile.draw(ctx);
      this.p1.draw(ctx);
      this.p2.draw(ctx);
      for (const particle of this.particles) particle.draw(ctx);

      ctx.restore();
      this.drawHUD();

      if (this.state === "paused") {
        ctx.fillStyle = "rgba(3,6,17,.48)";
        ctx.fillRect(0, 0, W, H);
      }

      if (this.announcerTimer > 0) {
        const fade = Math.min(1, this.announcerTimer * 2);
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.textAlign = "center";
        ctx.font = "italic 1000 72px system-ui";
        ctx.lineWidth = 10;
        ctx.strokeStyle = "rgba(0,0,0,.4)";
        ctx.strokeText(this.announcer, W / 2, 240);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(this.announcer, W / 2, 240);
        ctx.restore();
      }
    }

    drawBackground() {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#071024");
      sky.addColorStop(.55, "#1d1740");
      sky.addColorStop(1, "#3b1640");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Moon
      const moon = ctx.createRadialGradient(760, 110, 8, 760, 110, 75);
      moon.addColorStop(0, "#ffffff");
      moon.addColorStop(.3, "#8ffaf4");
      moon.addColorStop(1, "rgba(66,232,224,0)");
      ctx.fillStyle = moon;
      ctx.beginPath();
      ctx.arc(760, 110, 85, 0, Math.PI * 2);
      ctx.fill();

      const now = performance.now() * .001;
      for (const star of this.stars) {
        ctx.globalAlpha = .35 + Math.sin(now * 2 + star.p) * .25;
        ctx.fillStyle = "#d9ffff";
        ctx.fillRect(star.x, star.y, star.s, star.s);
      }
      ctx.globalAlpha = 1;

      // Futuristic skyline
      for (let i = 0; i < 18; i++) {
        const x = i * 58 - 10;
        const h = 70 + ((i * 47) % 115);
        ctx.fillStyle = i % 2 ? "#111936" : "#151b40";
        ctx.fillRect(x, FLOOR - h - 28, 48, h);
        ctx.fillStyle = i % 3 ? "rgba(66,232,224,.32)" : "rgba(255,79,154,.32)";
        for (let yy = FLOOR - h - 16; yy < FLOOR - 44; yy += 18) {
          ctx.fillRect(x + 8, yy, 5, 6);
          ctx.fillRect(x + 27, yy, 5, 6);
        }
      }

      // Holographic sign
      ctx.save();
      ctx.translate(W / 2, 305);
      ctx.globalAlpha = .32 + Math.sin(now * 3) * .06;
      ctx.strokeStyle = "#ff4f9a";
      ctx.lineWidth = 3;
      ctx.strokeRect(-90, -33, 180, 66);
      ctx.font = "900 22px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff88bc";
      ctx.fillText("NEON ARENA", 0, 8);
      ctx.restore();
    }

    drawArena() {
      const floorGradient = ctx.createLinearGradient(0, FLOOR - 10, 0, H);
      floorGradient.addColorStop(0, "#2e315a");
      floorGradient.addColorStop(1, "#090d1d");
      ctx.fillStyle = floorGradient;
      ctx.fillRect(0, FLOOR, W, H - FLOOR);

      ctx.strokeStyle = "rgba(66,232,224,.28)";
      ctx.lineWidth = 2;
      for (let x = -200; x < W + 200; x += 80) {
        ctx.beginPath();
        ctx.moveTo(W / 2, FLOOR);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = FLOOR + 12; y < H; y += 20) {
        ctx.globalAlpha = 1 - (y - FLOOR) / 140;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.fillRect(0, FLOOR - 7, W, 7);
      ctx.fillStyle = "#42e8e0";
      ctx.fillRect(0, FLOOR - 3, W, 2);
    }

    drawHUD() {
      const margin = 36;
      const barW = 350;
      const barH = 25;

      ctx.save();
      ctx.font = "900 17px system-ui";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(this.p1.name, margin, 34);
      ctx.textAlign = "right";
      ctx.fillText(this.p2.name + (this.p2.ai ? " · CPU" : ""), W - margin, 34);

      drawHealthBar(ctx, margin, 46, barW, barH, this.p1.health, false, this.p1.color);
      drawHealthBar(ctx, W - margin - barW, 46, barW, barH, this.p2.health, true, this.p2.color);
      drawEnergyBar(ctx, margin, 78, 230, 8, this.p1.energy, this.p1.accent, false);
      drawEnergyBar(ctx, W - margin - 230, 78, 230, 8, this.p2.energy, this.p2.accent, true);

      ctx.textAlign = "center";
      ctx.font = "1000 30px system-ui";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(Math.ceil(this.roundTimer)).padStart(2, "0"), W / 2, 66);

      drawRoundPips(ctx, W / 2 - 46, 86, this.p1.roundWins, this.p1.color, false);
      drawRoundPips(ctx, W / 2 + 46, 86, this.p2.roundWins, this.p2.color, true);

      ctx.font = "800 12px system-ui";
      ctx.fillStyle = "rgba(255,255,255,.62)";
      ctx.fillText(`ROUND ${this.round}`, W / 2, 96);
      ctx.restore();
    }

    loop = (time) => {
      const dt = Math.min(0.033, (time - this.lastTime) / 1000 || 0);
      this.lastTime = time;
      this.update(dt);
      this.draw();
      requestAnimationFrame(this.loop);
    };
  }

  function drawHealthBar(ctx, x, y, w, h, value, reverse, color) {
    ctx.fillStyle = "rgba(0,0,0,.48)";
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();

    const inner = clamp(value / 100, 0, 1) * (w - 6);
    ctx.fillStyle = color;
    const ix = reverse ? x + w - 3 - inner : x + 3;
    roundRect(ctx, ix, y + 3, inner, h - 6, 5);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,.28)";
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();
  }

  function drawEnergyBar(ctx, x, y, w, h, value, color, reverse) {
    ctx.fillStyle = "rgba(0,0,0,.45)";
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    const inner = clamp(value / 100, 0, 1) * w;
    ctx.fillStyle = color;
    roundRect(ctx, reverse ? x + w - inner : x, y, inner, h, 4);
    ctx.fill();

    if (value >= 40) {
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.font = "900 10px system-ui";
      ctx.textAlign = reverse ? "right" : "left";
      ctx.fillText("SPECIAL READY", reverse ? x + w : x, y + 20);
    }
  }

  function drawRoundPips(ctx, x, y, wins, color, reverse) {
    for (let i = 0; i < 2; i++) {
      const px = reverse ? x + i * 15 : x - i * 15;
      ctx.beginPath();
      ctx.arc(px, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = i < wins ? color : "rgba(255,255,255,.16)";
      ctx.fill();
    }
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w &&
           a.x + a.w > b.x &&
           a.y < b.y + b.h &&
           a.y + a.h > b.y;
  }

  function circleRectOverlap(cx, cy, radius, rect) {
    const closestX = clamp(cx, rect.x, rect.x + rect.w);
    const closestY = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy < radius * radius;
  }

  function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  const audio = new AudioEngine();
  const input = new InputManager();
  const game = new Game();

  document.querySelectorAll("[data-mode]").forEach(button => {
    button.addEventListener("click", () => game.start(button.dataset.mode));
  });

  document.getElementById("howToPlay").addEventListener("click", () => {
    menu.classList.add("hidden");
    help.classList.remove("hidden");
  });

  document.getElementById("closeHelp").addEventListener("click", () => {
    help.classList.add("hidden");
    menu.classList.remove("hidden");
  });

  continueRound.addEventListener("click", () => game.continue());
  pauseButton.addEventListener("click", () => game.togglePause());

  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("pointerdown", () => audio.unlock(), { once: true });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  requestAnimationFrame(game.loop);
})();
