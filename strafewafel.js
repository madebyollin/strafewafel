// Objective:
//
//   Strafewafel is a single-file js implementation of pleasant dual-stick first-person controls,
//   intended for chill non-FPS games (think The Witness, or Google Street View, not Quake).
//
//   Strafewafel is intended to work well with touch (mobile) and keyboard + mouse interfaces.
//
//
// Inputs and outputs:
//
//   Stroopwafel consumes keyboard / touch events.
//     You can bind these with swfl.addDefaultEventListeners(document.body);
//   Stroopwafel updates its internal state whenever you call swfl.step(timestamp);
//   Stroopwafel's output state is a position / orientation along with derivatives thereof.
//     You can access these at swfl.state.
//
//
// Coordinates and conventions:
//   The strafewafel coordinate system is +x forward, +y left, +z up.
//     This means that screen-space bird's-eye-view coordinates are (-y, -x)
//   The strafewafel units are meters, radians, and seconds.
//
// Related work:
//   Blender walk-mode controls: https://github.com/blender/blender/blob/2ddc574ad96607bc82960d66445a6bb5b4363874/source/blender/editors/space_view3d/view3d_navigate_walk.cc
//   Quake cl_input.c: https://github.com/id-Software/Quake-III-Arena/blob/master/code/client/cl_input.c

function Strafewafel() {
    const SWFL_CSS = `
        .swfl-control {
            position: absolute;
            bottom: 0px;
            width: clamp(25vh, 192px, 256px);
            height: clamp(25vh, 192px, 256px);
            border-radius:15vw;
            display: block;
            cursor: grab;
            touch-action: manipulation;
            user-select: none;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            transition: 0.2s ease opacity;
        }
        .swfl-control.locked {
            opacity:0.0;
        }
        .swfl-controlSocket {
            position: absolute;
            left: 25%;
            top: 25%;
            background: rgba(64 64 64 / 0.5);
            -webkit-backdrop-filter: blur(16px) saturate(200%);
            width:50%;
            height:50%;
            border-radius:50%;
            display: block;
        }
        .swfl-controlStick {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translateX(-50%) translateY(-50%);
            background: rgba(255,255,255,0.5);
            -webkit-backdrop-filter: blur(8px) saturate(200%);
            width:75%;
            height:75%;
            border-radius:75%;
            display: block;
        }
        .swfl-leftControl {
            left: 0;
        }
        .swfl-rightControl {
            right: 0;
        }
    `;
    const util = {
        clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
        snapToZero: (x, eps) => (Math.abs(x) > eps ? x : 0)
    }

    const config = {
        // what's the min / max xy velocity we'll allow?
        maxMoveSpeed_mps: 7,
        runSpeed_mps: 7,
        walkSpeed_mps: 3.5,

        // what's the min / max xy acceleration we'll allow?
        maxAccelerationXY_mps2: 75,

        // how rapid is the cooldown when you let go of the keys?
        pitchCooldownFactor: 0.75,
        yawCooldownFactor: 0.5,

        // max pitch before you can't look up / down anymore
        maxPitch_r: 1.5,

        // what's the min / max xy velocity we'll allow?
        maxAngularVelocityPY_rps: 2.0,
        lookSpeed_rps: 2.0,

        // what's the rate at which pointer locked mouse movement changes the view?
        pointerLockedRadiansPerPixel: 1.0 / 512.0,

        // what's the min / max xy acceleration we'll allow?
        maxAngularAccelerationPY_rps2: 30,

        // max delta t we'll allow before slowing time down
        maxDeltaT_s: 0.05,

        // tiny number
        eps: 1e-5
    };

    const state = {
        position_m: {
            x: 0,
            y: 0,
        },
        velocity_mps: {
            x: 0,
            y: 0,
        },
        targetVelocity_mps: {
            x: 0,
            y: 0,
        },
        view_r: {
            pitch: 0,
            yaw: 0,
        },
        angularVelocity_rps: {
            pitch: 0,
            yaw: 0,
        },
        targetAngularVelocity_rps: {
            pitch: 0,
            yaw: 0,
        },
        inputs: {
            total: 0,
            keyboard: {
                pressed: { }
            },
            screen: {
                pointerLocked: false,
                pressed: { }
            }
        }
    };

    // TODO: combine these poor things
    // also TODO: seems like a lot of people probably want diagonal motion in multikey instead of the most-recent-key thing we use for 2d?
    function findActiveKey(inputs, action) {
        let activeIndex = 0;
        let activeKey = null;
        // find the key with the highest index
        for (const k in inputs.pressed) {
            if (inputs.pressed[k].index >= activeIndex && inputs.pressed[k].action == action)
            {
                activeKey = k;
                activeIndex = inputs.pressed[k].index;
            }
        }
        return activeKey;
    }


    function applyYaw(xy, yaw)
    {
        // rotate a canonical vector to a yawed vector
        return {
            x: xy.x * Math.cos(yaw) - xy.y * Math.sin(yaw),
            y: xy.x * Math.sin(yaw) + xy.y * Math.cos(yaw),
        };
    }

    function step(dt_s) {
        dt_s = Math.min(dt_s, config.maxDeltaT_s);
        let targetSpeed_mps = 0.0;
        const activePositionKey = findActiveKey(state.inputs.keyboard, "move");
        if (activePositionKey)
        {
            targetSpeed_mps = state.inputs.keyboard.pressed[activePositionKey].shift ? config.runSpeed_mps : config.walkSpeed_mps;
        }

        state.targetVelocity_mps = { x: 0.0, y: 0.0 };
        if (activePositionKey == "w") { state.targetVelocity_mps = applyYaw({x: targetSpeed_mps, y: 0.0}, state.view_r.yaw); }
        if (activePositionKey == "a") { state.targetVelocity_mps = applyYaw({x: 0.0, y: targetSpeed_mps}, state.view_r.yaw); }
        if (activePositionKey == "s") { state.targetVelocity_mps = applyYaw({x: -targetSpeed_mps, y: 0.0}, state.view_r.yaw); }
        if (activePositionKey == "d") { state.targetVelocity_mps = applyYaw({x: 0.0, y: -targetSpeed_mps}, state.view_r.yaw); }

        // check for touch override of the keyboard
        const activeScreenPositionKey = findActiveKey(state.inputs.screen, "move");
        if (activeScreenPositionKey &&
            (!activePositionKey || state.inputs.screen.pressed[activeScreenPositionKey].index > state.inputs.keyboard.pressed[activePositionKey].index))
        {
            const press = state.inputs.screen.pressed[activeScreenPositionKey];
            state.targetVelocity_mps = applyYaw({x: press.position.ctrlX * config.runSpeed_mps, y: press.position.ctrlY * config.runSpeed_mps}, state.view_r.yaw);
        }

        const acceleration_mps2 = { 
            x: util.clamp((state.targetVelocity_mps.x - state.velocity_mps.x) / Math.max(dt_s, config.eps), -config.maxAccelerationXY_mps2, config.maxAccelerationXY_mps2),
            y: util.clamp((state.targetVelocity_mps.y - state.velocity_mps.y) / Math.max(dt_s, config.eps), -config.maxAccelerationXY_mps2, config.maxAccelerationXY_mps2),
        };
        if (activePositionKey == null) {
            acceleration_mps2.x *= 0.5;
            acceleration_mps2.y *= 0.5;
        }

        state.velocity_mps.x = util.clamp(util.snapToZero(state.velocity_mps.x + acceleration_mps2.x * dt_s, config.eps), -config.maxMoveSpeed_mps, config.maxMoveSpeed_mps);
        state.velocity_mps.y = util.clamp(util.snapToZero(state.velocity_mps.y + acceleration_mps2.y * dt_s, config.eps), -config.maxMoveSpeed_mps, config.maxMoveSpeed_mps);

        state.position_m.x += state.velocity_mps.x * dt_s;
        state.position_m.y += state.velocity_mps.y * dt_s;

        // view angle
        const activeViewKey = findActiveKey(state.inputs.keyboard, "look");
        let targetSpeed_rps = 0.0;
        if (activeViewKey) {
            targetSpeed_rps = config.lookSpeed_rps;
        }
        state.targetAngularVelocity_rps = { pitch: 0.0, yaw: 0.0 };
        if (activeViewKey == "i") { state.targetAngularVelocity_rps = {pitch: targetSpeed_rps, yaw: 0.0}; }
        if (activeViewKey == "j") { state.targetAngularVelocity_rps = {pitch: 0.0, yaw: targetSpeed_rps}; }
        if (activeViewKey == "k") { state.targetAngularVelocity_rps = {pitch: -targetSpeed_rps, yaw: 0.0}; }
        if (activeViewKey == "l") { state.targetAngularVelocity_rps = {pitch: 0.0, yaw: -targetSpeed_rps}; }

        // check for touch override of the keyboard
        const activeScreenViewKey = findActiveKey(state.inputs.screen, "look");
        if (state.inputs.screen.pressed[activeScreenViewKey] &&
            (!activeViewKey || state.inputs.screen.pressed[activeScreenViewKey].index > state.inputs.keyboard.pressed[activeViewKey].index))
        {
            const press = state.inputs.screen.pressed[activeScreenViewKey];
            state.targetAngularVelocity_rps = {pitch: press.position.ctrlX * config.lookSpeed_rps, yaw: press.position.ctrlY * config.lookSpeed_rps};
        }

        // slow movement when pitch is about to hit limits
        // TODO: either make the limit symmetric or make this clamp properly
        const pitchSoftLimiter = 1.0 - util.clamp(5 * Math.abs(state.view_r.pitch) / config.maxPitch_r - 4, 0.0, 1.0);
        if (Math.sign(state.targetAngularVelocity_rps.pitch) == Math.sign(state.view_r.pitch))
        {
            state.targetAngularVelocity_rps.pitch *= pitchSoftLimiter;
        }

        const angularAcceleration_rps2 = { 
            pitch: util.clamp((state.targetAngularVelocity_rps.pitch - state.angularVelocity_rps.pitch) / Math.max(dt_s, config.eps), -config.maxAngularAccelerationPY_rps2, config.maxAngularAccelerationPY_rps2),
            yaw: util.clamp((state.targetAngularVelocity_rps.yaw - state.angularVelocity_rps.yaw) / Math.max(dt_s, config.eps), -config.maxAngularAccelerationPY_rps2, config.maxAngularAccelerationPY_rps2),
        };

        // additional cooldown so that things come smoothly to rest when you let go of the key
        if (!activeViewKey) {
            angularAcceleration_rps2.pitch *= config.pitchCooldownFactor;
            angularAcceleration_rps2.yaw *= config.yawCooldownFactor;
        }

        state.angularVelocity_rps.pitch = util.clamp(util.snapToZero(state.angularVelocity_rps.pitch + angularAcceleration_rps2.pitch * dt_s, config.eps), -config.maxAngularVelocityPY_rps, config.maxAngularVelocityPY_rps);
        state.angularVelocity_rps.yaw = util.clamp(util.snapToZero(state.angularVelocity_rps.yaw + angularAcceleration_rps2.yaw * dt_s, config.eps), -config.maxAngularVelocityPY_rps, config.maxAngularVelocityPY_rps);

        if (activeScreenViewKey == "pointerlock")
        {
            // direct override no smoothing
            state.angularVelocity_rps = state.targetAngularVelocity_rps;
        }

        state.view_r.pitch += state.angularVelocity_rps.pitch * dt_s;
        state.view_r.pitch = util.clamp(state.view_r.pitch, -config.maxPitch_r, config.maxPitch_r);
        state.view_r.yaw += state.angularVelocity_rps.yaw * dt_s;
    }

    function keyDown(key) {
        // need to keep these sorted by order to have nice multi-key support
        let activeKey = findActiveKey(state.inputs.keyboard, "move");
        if (key == "Shift" && activeKey) {
            state.inputs.keyboard.pressed[activeKey].shift = true;
        } else {
            let action = null;
            if (["w", "a", "s", "d"].includes(key.toLowerCase())) action = "move";
            if (["i", "j", "k", "l"].includes(key.toLowerCase())) action = "look";
            state.inputs.keyboard.pressed[key.toLowerCase()] = { index: state.inputs.total, shift: key == key.toUpperCase(), action };
            state.inputs.total++;
        }
    }

    function keyUp(key) {
        let activeKey = findActiveKey(state.inputs.keyboard, "move");
        if (key == "Shift" && activeKey) {
            state.inputs.keyboard.pressed[activeKey].shift = false;
        } else {
            delete state.inputs.keyboard.pressed[key.toLowerCase()];
        }
    }

    function resetInputs() {
        state.inputs.keyboard.pressed = {};
        state.inputs.screen.pressed = {};
    }

    function handlePointerLockChange() {
        const el = this;
        if (document.pointerLockElement) {
            state.inputs.screen.pointerLocked = true;
        } else {
            state.inputs.screen.pointerLocked = false;
            delete state.inputs.screen.pressed["pointerlock"];
        }
    }

    function addDefaultEventListeners(el) {
        el.addEventListener("keydown", (ev) => {
            keyDown(ev.key);
        });
        el.addEventListener("keyup", (ev) => {
            keyUp(ev.key);
        });
        window.addEventListener("blur", resetInputs);
        // these need to be global so that drags can continue across the entire screen
        el.addEventListener("mousemove", pressMove);
        el.addEventListener("mouseup", pressUp);
        el.addEventListener("touchmove", pressMove);
        el.addEventListener("touchend", pressUp);
        el.addEventListener("touchcancel", pressUp);
        // try to get mouse look too on desktop
        document.addEventListener("pointerlockchange", handlePointerLockChange);
        el.addEventListener("click", () => { 
            if (!document.pointerLockElement && el.requestPointerLock)
            {
                el.requestPointerLock();
            }
        });
    }

    function getControlParent(el)
    {
        // ugh this shouldn't be needed, there's probably some other property on the touch that has it
        while (el && !el.classList.contains("swfl-leftControl") && !el.classList.contains("swfl-rightControl"))
        {
            el = el.parentElement;
        }
        return el;
    }

    function pressDown(ev)
    {
        ev.preventDefault();
        let action = null;
        let touches = ev.changedTouches || [ev];
        for (let touch of touches){
            let id = touch.identifier ? touch.identifier : 0;
            let target = touch.target ? getControlParent(touch.target) : this;
            if (target.classList.contains("swfl-leftControl")) action = "move";
            if (target.classList.contains("swfl-rightControl")) action = "look";

            const rect = target.getBoundingClientRect();
      
            // Calculate element center
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            // Get click position relative to the element
            const clickX = touch.clientX - rect.left;
            const clickY = touch.clientY - rect.top;
            
            // Calculate relative offset from center in [-1, 1]
            // BEV control-system coordinates
            const ctrlY = -2 * (clickX - rect.width / 2) / rect.width;
            const ctrlX = -2 * (clickY - rect.height / 2) / rect.height;
            
            state.inputs.screen.pressed[id] = { index: state.inputs.total, position: { ctrlX, ctrlY }, rect, action };
            state.inputs.total++;
        }
    }

    function pressMove(ev)
    {
        let touches = ev.changedTouches || [ev];
        for (let touch of touches){
            let id = touch.identifier ? touch.identifier : 0;
            if (state.inputs.screen.pressed[id]) {
                ev.preventDefault();
                const rect = state.inputs.screen.pressed[id].rect;
          
                // Calculate element center
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                
                // Get click position relative to the element
                const clickX = touch.clientX  - rect.left;
                const clickY = touch.clientY - rect.top;
                
                // Calculate relative offset from center in [-1, 1]
                // BEV control-system coordinates
                const ctrlY = -2 * (clickX - rect.width / 2) / rect.width;
                const ctrlX = -2 * (clickY - rect.height / 2) / rect.height;
                
                state.inputs.screen.pressed[id].index = state.inputs.total;
                state.inputs.screen.pressed[id].position = { ctrlX, ctrlY };
                state.inputs.total++;
            }
        }
        // if we have pointer lock, we should also add events for that
        if (state.inputs.screen.pointerLocked)
        {
            let ctrlY = 0.0;
            let ctrlX = 0.0;
            const timestamp_ms = Date.now(); // ms
            if (state.inputs.screen.pressed["pointerlock"])
            {
                const prevTimestamp_ms = state.inputs.screen.pressed["pointerlock"].timestamp_ms;
                const deltaT_s = (timestamp_ms - prevTimestamp_ms) / 1000.0;
                ctrlY = -ev.movementX / deltaT_s * config.pointerLockedRadiansPerPixel;
                ctrlX = -ev.movementY / deltaT_s * config.pointerLockedRadiansPerPixel;
            }

            const action = "look";
            const rect = this.getBoundingClientRect();
            state.inputs.screen.pressed["pointerlock"] = { index: state.inputs.total, position: { ctrlX, ctrlY }, rect, action, timestamp_ms };
            state.inputs.total++;
        } else {
            delete state.inputs.screen.pressed["pointerlock"];
        }
    }


    function pressUp(ev)
    {
        let touches = ev.changedTouches || [ev];
        for (let touch of touches) {
            let id = touch.identifier ? touch.identifier : 0;
            delete state.inputs.screen.pressed[id];
        }
    }

    // style element
    const styleEl = document.createElement("style");
    styleEl.type = "text/css";
    styleEl.textContent = SWFL_CSS;

    // control elements
    const leftControlEl = document.createElement("div");
    leftControlEl.classList.add("swfl-leftControl", "swfl-control");
    const leftControlSocket = document.createElement("div");
    leftControlSocket.classList.add("swfl-controlSocket");
    leftControlEl.appendChild(leftControlSocket);
    const leftControlStick = document.createElement("div");
    leftControlStick.classList.add("swfl-controlStick");
    leftControlSocket.appendChild(leftControlStick);

    leftControlEl.addEventListener("mousedown", pressDown);
    leftControlEl.addEventListener("touchstart", pressDown);

    const rightControlEl = document.createElement("div");
    rightControlEl.classList.add("swfl-rightControl", "swfl-control");
    const rightControlSocket = document.createElement("div");
    rightControlSocket.classList.add("swfl-controlSocket");
    rightControlEl.appendChild(rightControlSocket);
    const rightControlStick = document.createElement("div");
    rightControlStick.classList.add("swfl-controlStick");
    rightControlSocket.appendChild(rightControlStick);

    rightControlEl.addEventListener("mousedown", pressDown);
    rightControlEl.addEventListener("touchstart", pressDown);

    function addDefaultControlElements(el) {
        el.appendChild(styleEl);
        el.appendChild(leftControlEl);
        el.appendChild(rightControlEl);
    }

    function updateControlElements() {
        const canonicalVelocity_mps = applyYaw(state.velocity_mps, -state.view_r.yaw);
        const maxShift = 0.25;
        leftControlStick.style.left = `${100 * (0.5 - maxShift * canonicalVelocity_mps.y / config.maxMoveSpeed_mps)}%`;
        leftControlStick.style.top = `${100 * (0.5 - maxShift * canonicalVelocity_mps.x / config.maxMoveSpeed_mps)}%`;

        rightControlStick.style.left = `${100 * (0.5 - maxShift * state.angularVelocity_rps.yaw / config.maxAngularVelocityPY_rps)}%`;
        rightControlStick.style.top = `${100 * (0.5 - maxShift * state.angularVelocity_rps.pitch / config.maxAngularVelocityPY_rps)}%`;

        if (state.inputs.screen.pointerLocked)
        {
            leftControlEl.classList.add("locked");
            rightControlEl.classList.add("locked");
        } else {
            leftControlEl.classList.remove("locked");
            rightControlEl.classList.remove("locked");
        }
    }

    // public API
    return {
        util,
        step,
        state,
        config,
        addDefaultEventListeners,
        addDefaultControlElements,
        updateControlElements,
    };
}
