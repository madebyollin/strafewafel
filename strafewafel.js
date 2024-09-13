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
//   Strafewafel consumes keyboard / touch events.
//     You can bind these with swfl.addDefaultEventListeners(document.body);
//   Strafewafel updates its internal state whenever you call swfl.step(dt_s);
//   Strafewafel's output state is a position / orientation along with derivatives thereof.
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

// functional paradise, no external state here
function StrafewafelCore() {
    const util = {
        clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
        snapToZero: (x, eps) => (Math.abs(x) > eps ? x : 0),
        // rotate a canonical 2d vector to a yawed vector
        applyYaw: (xy, yaw) => { return {x: xy.x * Math.cos(yaw) - xy.y * Math.sin(yaw), y: xy.x * Math.sin(yaw) + xy.y * Math.cos(yaw) }; },
        // return the scaler that would make vector's l2 norm match its current largest single-axis norm
        clampDiagonalMotion: (x, y, eps) => {
            const mn = Math.max(Math.abs(x), Math.abs(y));
            const n = Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2));
            if (n < eps) return 1.0;
            return mn / n;
        },
        // wrap angles to avoid getting too far from origin
        wrapAngle: x => x % (2 * Math.PI)
    };

    function Config() {
        return {
            // what's the min / max xy velocity we'll allow?
            maxMoveSpeed_mps: 7,
            runSpeed_mps: 7,
            walkSpeed_mps: 3.5,
            // how much does walking backwards slow you down?
            backwardsSpeedMultiple: 0.75,

            // what's the min / max xy acceleration we'll allow?
            maxAccelerationXY_mps2: 75,

            // how rapid is the cooldown when you let go of the keys?
            pitchCooldownFactor: 0.75,
            yawCooldownFactor: 0.5,

            // max pitch before you can't look up / down anymore
            maxPitch_r: 1.5,

            // what's the min / max xy velocity we'll allow?
            maxAngularVelocityPY_rps: 2.0,
            viewSpeed_rps: 2.0,

            // what's the rate at which pointer locked mouse movement changes the view?
            pointerLockedRadiansPerPixel: 1.0 / 512.0,

            // what's the min / max xy acceleration we'll allow?
            maxAngularAccelerationPY_rps2: 30,

            // max delta t we'll allow before slowing time down
            maxDeltaT_s: 0.05,

            // tiny number
            eps: 1e-5
        };
    }

    // player state
    function State() {
        return {
            position_m: {
                x: 0,
                y: 0,
            },
            velocity_mps: {
                x: 0,
                y: 0,
            },
            view_r: {
                pitch: 0,
                yaw: 0,
            },
            viewVelocity_rps: {
                pitch: 0,
                yaw: 0,
            },
        };
    };

    // UI state
    function UIState() {
        return {
            // incrementing index of input events, to break ties
            total: 0,
            // dictionary of keyboard input events; key -> event
            keyboard: {
                pressed: { }
            },
            // dictionary of onscreen input events; unique ID -> event
            screen: {
                pointerLocked: false,
                pressed: { }
            }
        };
    }

    function UI() {
        const SWFL_CSS = `
            .swfl-control {
                position: absolute; bottom: 0px; width: clamp(25vh, 192px, 256px); height: clamp(25vh, 192px, 256px);
                cursor: grab; touch-action: manipulation; user-select: none; -webkit-touch-callout: none; -webkit-user-select: none;
                border-radius: 15vw; transition: 0.2s ease opacity;
            }
            .swfl-control.locked { opacity:0.0; }
            .swfl-controlSocket {
                position: absolute; left: 25%; top: 25%; width:50%; height:50%;
            }
            .swfl-controlSocketDisc {
                position: absolute; left: 25%; top: 25%; width:50%; height:50%;
                background: rgba(64, 64, 64, 0.5); border-radius:50%;
                -webkit-backdrop-filter: blur(8px) saturate(200%);
                backdrop-filter: blur(8px) saturate(200%);
            }
            .swfl-controlStick {
                position: absolute; left: 50%; top: 50%; width:75%; height:75%; transform: translateX(-50%) translateY(-50%);
                background: rgba(255,255,255,0.5); border-radius:75%;
                transition: 0.2s ease background-color;
                -webkit-backdrop-filter: blur(8px) saturate(200%);
                backdrop-filter: blur(8px) saturate(200%);
                z-index: 2;
            }
            .swfl-controlStick.pressed {
                background: rgba(255,255,255,0.6);
            }
            .swfl-leftControl { left: 0; }
            .swfl-rightControl { right: 0; }
        `;
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
        const leftControlSocketDisc = document.createElement("div");
        leftControlSocketDisc.classList.add("swfl-controlSocketDisc");
        leftControlEl.appendChild(leftControlSocketDisc);
        const leftControlStick = document.createElement("div");
        leftControlStick.classList.add("swfl-controlStick");
        leftControlSocket.appendChild(leftControlStick);

        const rightControlEl = document.createElement("div");
        rightControlEl.classList.add("swfl-rightControl", "swfl-control");
        const rightControlSocket = document.createElement("div");
        rightControlSocket.classList.add("swfl-controlSocket");
        rightControlEl.appendChild(rightControlSocket);
        const rightControlSocketDisc = document.createElement("div");
        rightControlSocketDisc.classList.add("swfl-controlSocketDisc");
        rightControlEl.appendChild(rightControlSocketDisc);
        const rightControlStick = document.createElement("div");
        rightControlStick.classList.add("swfl-controlStick");
        rightControlSocket.appendChild(rightControlStick);
        return {
            styleEl,
            leftControlEl, rightControlEl,
            leftControlSocket, rightControlSocket,
            leftControlStick, rightControlStick
        };
    };

    function makeDisplacedControlStickTransform(config, vec) {
        const squaredNorm = Math.pow(vec.x, 2) + Math.pow(vec.y, 2);
        const angle_rad = squaredNorm > config.eps ? Math.atan2(vec.x, vec.y) : 0.0;
        return `translateX(-50%) translateY(-50%) rotate(${angle_rad}rad) scaleX(${1.0 - 0.1 * squaredNorm}) scaleY(${1.0 - 0.025 * squaredNorm})`;
    }

    function renderStateToUI(_state, _config, _uiState, ui) {
        const [state, config, uiState] = [_state, _config, _uiState]; // no touchy
        const canonicalVelocity_mps = util.applyYaw(state.velocity_mps, -state.view_r.yaw);
        const maxShift = 0.25;
        ui.leftControlStick.style.left = `${100 * (0.5 - maxShift * canonicalVelocity_mps.y / config.maxMoveSpeed_mps)}%`;
        ui.leftControlStick.style.top = `${100 * (0.5 - maxShift * canonicalVelocity_mps.x / config.maxMoveSpeed_mps)}%`;
        ui.leftControlStick.style.transform = makeDisplacedControlStickTransform(config, {
            x:canonicalVelocity_mps.x / config.maxMoveSpeed_mps,
            y:canonicalVelocity_mps.y / config.maxMoveSpeed_mps
        });
        if (findActiveInputAction(uiState.keyboard, config, "moveX") || findActiveInputAction(uiState.keyboard, config, "moveY") || findActiveInputAction(uiState.screen, config, "move"))
        {
            ui.leftControlStick.classList.add("pressed");
        } else {
            ui.leftControlStick.classList.remove("pressed");
        }

        ui.rightControlStick.style.left = `${100 * (0.5 - maxShift * state.viewVelocity_rps.yaw / config.maxAngularVelocityPY_rps)}%`;
        ui.rightControlStick.style.top = `${100 * (0.5 - maxShift * state.viewVelocity_rps.pitch / config.maxAngularVelocityPY_rps)}%`;
        ui.rightControlStick.style.transform = makeDisplacedControlStickTransform(config, {
            x:state.viewVelocity_rps.pitch / config.maxAngularVelocityPY_rps,
            y:state.viewVelocity_rps.yaw / config.maxAngularVelocityPY_rps
        });

        if (findActiveInputAction(uiState.keyboard, config, "viewP") || findActiveInputAction(uiState.keyboard, config, "viewY") || findActiveInputAction(uiState.screen, config, "view"))
        {
            ui.rightControlStick.classList.add("pressed");
        } else {
            ui.rightControlStick.classList.remove("pressed");
        }

        if (uiState.screen.pointerLocked)
        {
            ui.leftControlEl.classList.add("locked");
            ui.rightControlEl.classList.add("locked");
        } else {
            ui.leftControlEl.classList.remove("locked");
            ui.rightControlEl.classList.remove("locked");
        }
    }

    // this function searches the UI State and finds the relevant input
    function findActiveInputAction(_inputs, _config, _action) {
        const [inputs, config, action] = [_inputs, _config, _action]; // no touchy
        let activeIndex = 0;
        let activeKey = null;
        // TODO: this should be a parameter not a secret internal state, fix
        let now_ms = Date.now();
        // find the key with the highest index
        for (const k in inputs.pressed) {
            if (inputs.pressed[k].index >= activeIndex && inputs.pressed[k].action == action)
            {
                if (k == "pointerlock" && inputs.pressed[k].timestamp_ms && (now_ms - inputs.pressed[k].timestamp_ms) / 1000.0 > config.maxDeltaT_s) {
                    // for pointer lock movement events, events will get stuck as "move" with no mouseup,
                    // which would leave the view spinning indefinitely.
                    // ignore those events based on a dedicated timestamp staleness check.
                    continue;
                }
                activeKey = k;
                activeIndex = inputs.pressed[k].index;
            }
        }
        return activeKey;
    }


    function stepPlayerState(_state, _config, _uiState, dt_s) {
        const [state, config, uiState] = [_state, _config, _uiState]; // no touchy

        dt_s = Math.min(dt_s, config.maxDeltaT_s);

        // ---------------------------------------------------------------------
        // Update viewing state. Do this first because the viewing state affects
        // the coordinate frame for movement controls
        // ---------------------------------------------------------------------
        let targetAngularVelocity_rps = { pitch: 0.0, yaw: 0.0 };
        let activeViewIndex = 0;
        // check axes separately to allow diagonal motion
        const activeViewPKey = findActiveInputAction(uiState.keyboard, config, "viewP");
        if (activeViewPKey) activeViewIndex = uiState.keyboard.pressed[activeViewPKey].index;
        if (activeViewPKey == "i") { targetAngularVelocity_rps.pitch = config.viewSpeed_rps }
        if (activeViewPKey == "k") { targetAngularVelocity_rps.pitch = -config.viewSpeed_rps }

        const activeViewYKey = findActiveInputAction(uiState.keyboard, config, "viewY");
        if (activeViewYKey) activeViewIndex = uiState.keyboard.pressed[activeViewYKey].index;
        if (activeViewYKey == "j") { targetAngularVelocity_rps.yaw = config.viewSpeed_rps }
        if (activeViewYKey == "l") { targetAngularVelocity_rps.yaw = -config.viewSpeed_rps }

        const viewRescale = util.clampDiagonalMotion(targetAngularVelocity_rps.pitch, targetAngularVelocity_rps.yaw, config.eps)
        targetAngularVelocity_rps.pitch *= viewRescale;
        targetAngularVelocity_rps.yaw *= viewRescale;

        // check for touch override of the keyboard
        const activeScreenViewKey = findActiveInputAction(uiState.screen, config, "view");
        if (uiState.screen.pressed[activeScreenViewKey] &&
            (!(activeViewPKey || activeViewYKey) || uiState.screen.pressed[activeScreenViewKey].index > activeViewIndex))
        {
            const press = uiState.screen.pressed[activeScreenViewKey];
            targetAngularVelocity_rps = {
                pitch: press.position.ctrlX * config.viewSpeed_rps,
                yaw: press.position.ctrlY * config.viewSpeed_rps
            };
        }

        // slow movement when pitch is about to hit limits
        // TODO: either make the limit symmetric or make this clamp properly
        const pitchSoftLimiter = 1.0 - util.clamp(5 * Math.abs(state.view_r.pitch) / config.maxPitch_r - 4, 0.0, 1.0);
        if (Math.sign(targetAngularVelocity_rps.pitch) == Math.sign(state.view_r.pitch))
        {
            targetAngularVelocity_rps.pitch *= pitchSoftLimiter;
        }

        const viewAcceleration_rps2 = {
            pitch: util.clamp((targetAngularVelocity_rps.pitch - state.viewVelocity_rps.pitch) / Math.max(dt_s, config.eps), -config.maxAngularAccelerationPY_rps2, config.maxAngularAccelerationPY_rps2),
            yaw: util.clamp((targetAngularVelocity_rps.yaw - state.viewVelocity_rps.yaw) / Math.max(dt_s, config.eps), -config.maxAngularAccelerationPY_rps2, config.maxAngularAccelerationPY_rps2),
        };

        // additional cooldown so that things come smoothly to rest when you let go of the key
        if (!activeViewPKey) { viewAcceleration_rps2.pitch *= config.pitchCooldownFactor; }
        if (!activeViewYKey) { viewAcceleration_rps2.yaw *= config.yawCooldownFactor; }

        // smoothed and clamped version
        const viewVelocity_rps = {
            pitch: util.clamp(util.snapToZero(state.viewVelocity_rps.pitch + viewAcceleration_rps2.pitch * dt_s, config.eps), -config.maxAngularVelocityPY_rps, config.maxAngularVelocityPY_rps),
            yaw: util.clamp(util.snapToZero(state.viewVelocity_rps.yaw + viewAcceleration_rps2.yaw * dt_s, config.eps), -config.maxAngularVelocityPY_rps, config.maxAngularVelocityPY_rps),
        };

        if (activeScreenViewKey == "pointerlock")
        {
            // direct override no smoothing
            viewVelocity_rps.pitch = targetAngularVelocity_rps.pitch;
            viewVelocity_rps.yaw = targetAngularVelocity_rps.yaw;
        }

        const view_r = {
            pitch: util.clamp(state.view_r.pitch + state.viewVelocity_rps.pitch * dt_s, -config.maxPitch_r, config.maxPitch_r),
            yaw: util.wrapAngle(state.view_r.yaw + state.viewVelocity_rps.yaw * dt_s)
        };

        // ---------------------------------------------------------------------
        // Update movement state. Do this second because the viewing state affects
        // the coordinate frame for movement controls.
        // ---------------------------------------------------------------------

        function moveSpeedForKey(key) {
            return uiState.keyboard.pressed[key].shift ? config.runSpeed_mps : config.walkSpeed_mps;
        }
        let targetVelocity_mps = { x: 0.0, y: 0.0 };
        let activeMoveIndex = 0;
        // check axes separately to allow diagonal motion
        const activeMoveXKey = findActiveInputAction(uiState.keyboard, config, "moveX");
        if (activeMoveXKey) activeMoveIndex = uiState.keyboard.pressed[activeMoveXKey].index;
        if (activeMoveXKey == "w") { targetVelocity_mps.x = moveSpeedForKey(activeMoveXKey) }
        if (activeMoveXKey == "s") { targetVelocity_mps.x = -moveSpeedForKey(activeMoveXKey) * config.backwardsSpeedMultiple }

        const activeMoveYKey = findActiveInputAction(uiState.keyboard, config, "moveY");
        if (activeMoveYKey) activeMoveIndex = uiState.keyboard.pressed[activeMoveYKey].index;
        if (activeMoveYKey == "a") { targetVelocity_mps.y = moveSpeedForKey(activeMoveYKey) }
        if (activeMoveYKey == "d") { targetVelocity_mps.y = -moveSpeedForKey(activeMoveYKey) }

        const moveRescale = util.clampDiagonalMotion(targetVelocity_mps.x, targetVelocity_mps.y, config.eps);
        targetVelocity_mps.x *= moveRescale;
        targetVelocity_mps.y *= moveRescale;
        targetVelocity_mps = util.applyYaw(targetVelocity_mps, view_r.yaw);

        // check for touch override of the keyboard
        const activeScreenPositionKey = findActiveInputAction(uiState.screen, config, "move");
        if (activeScreenPositionKey &&
            (!(activeMoveXKey || activeMoveYKey) || uiState.screen.pressed[activeScreenPositionKey].index > activeMoveIndex))
        {
            const press = uiState.screen.pressed[activeScreenPositionKey];
            targetVelocity_mps = util.applyYaw({x: press.position.ctrlX * config.runSpeed_mps, y: press.position.ctrlY * config.runSpeed_mps}, view_r.yaw);
        }

        const acceleration_mps2 = { 
            x: util.clamp((targetVelocity_mps.x - state.velocity_mps.x) / Math.max(dt_s, config.eps), -config.maxAccelerationXY_mps2, config.maxAccelerationXY_mps2),
            y: util.clamp((targetVelocity_mps.y - state.velocity_mps.y) / Math.max(dt_s, config.eps), -config.maxAccelerationXY_mps2, config.maxAccelerationXY_mps2),
        };

        // additional cooldown so that things come smoothly to rest when you let go of the key
        if (activeMoveXKey == null) {
            acceleration_mps2.x *= 0.5;
        }
        if (activeMoveYKey == null) {
            acceleration_mps2.y *= 0.5;
        }

        // the snap to zero here is kinda janky, it was needed to prevent weird floating point fluctuations when converging to stop
        const velocity_mps = {
            x: util.clamp(util.snapToZero(state.velocity_mps.x + acceleration_mps2.x * dt_s, config.eps), -config.maxMoveSpeed_mps, config.maxMoveSpeed_mps),
            y: util.clamp(util.snapToZero(state.velocity_mps.y + acceleration_mps2.y * dt_s, config.eps), -config.maxMoveSpeed_mps, config.maxMoveSpeed_mps)
        };

        const position_m = {
            x: state.position_m.x + velocity_mps.x * dt_s,
            y: state.position_m.y + velocity_mps.y * dt_s,
        };

        const outState = {
            position_m,
            velocity_mps,
            view_r,
            viewVelocity_rps,
        };
        // TODO: this is a cursed idiom
        console.assert(JSON.stringify(Object.keys(state).sort()) == JSON.stringify(Object.keys(outState).sort()));
        return outState;
    }

    return {
        util,
        State,
        Config,
        UI,
        UIState,
        renderStateToUI,
        stepPlayerState,
        findActiveInputAction
    };
}

// imperative containment zone.
// config stuff goes in config, state goes in state
function Strafewafel() {
    const core = StrafewafelCore();
    const ui = core.UI();
    const util = core.util;
    const config = core.Config();
    const uiState = core.UIState();

    let state = core.State();

    ui.leftControlEl.addEventListener("mousedown", pressDown);
    ui.leftControlEl.addEventListener("touchstart", pressDown);

    ui.rightControlEl.addEventListener("mousedown", pressDown);
    ui.rightControlEl.addEventListener("touchstart", pressDown);

    function step(dt_s) {
        // inplace update
        Object.assign(
            state,
            core.stepPlayerState(state, config, uiState, dt_s)
        );
    }

    function keyDown(key, shiftPressed) {
        let action = null;
        if (key == "Shift") {
            // keydown for shift key means all pressed keys become shifted;
            // this is important if the user e.g. presses w, mashes
            // a and d so that the w repeat events stop firing,
            // and then presses shift to start sprinting
            for (let key in uiState.keyboard.pressed)
            {
                if (!uiState.keyboard.pressed[key].shift)
                {
                    uiState.keyboard.pressed[key].shift = true;
                }
            }
        }
        if (["w", "s"].includes(key.toLowerCase())) action = "moveX";
        if (["a", "d"].includes(key.toLowerCase())) action = "moveY";
        if (["i", "k"].includes(key.toLowerCase())) action = "viewP";
        if (["j", "l"].includes(key.toLowerCase())) action = "viewY";
        if (action) {
            const shift = key == key.toUpperCase() || shiftPressed;
            uiState.keyboard.pressed[key.toLowerCase()] = { index: uiState.total, shift: shift, action };
            // need to keep these sorted by order to have nice multi-key support
            uiState.total++;
        }
    }

    function keyUp(key) {
        if (key == "Shift") {
            // keyup for shift key means no more shifted keys
            for (let key in uiState.keyboard.pressed)
            {
                if (uiState.keyboard.pressed[key].shift)
                {
                    uiState.keyboard.pressed[key].shift = false;
                }
            }
        }
        delete uiState.keyboard.pressed[key.toLowerCase()];
    }

    function resetInputs() {
        uiState.keyboard.pressed = {};
        uiState.screen.pressed = {};
    }

    function handlePointerLockChange() {
        const el = this;
        if (document.pointerLockElement) {
            uiState.screen.pointerLocked = true;
        } else {
            uiState.screen.pointerLocked = false;
            delete uiState.screen.pressed["pointerlock"];
        }
    }

    function addDefaultEventListeners(el) {
        el.addEventListener("keydown", (ev) => {
            keyDown(ev.key, ev.shiftKey);
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
        // try to get pointer lock on desktop
        document.addEventListener("pointerlockchange", handlePointerLockChange);
        el.addEventListener("mousedown", (ev) => {
            // clicking on controls doesn't trigger pointer-lock mode
            if (getControlParent(ev.target)) {
                return;
            }
            if (!document.pointerLockElement && el.requestPointerLock)
            {
                el.requestPointerLock();
            }
        });
    }

    function getControlParent(el)
    {
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
            let id = touch.identifier ? touch.identifier : "mouse";
            let target = touch.target ? getControlParent(touch.target) : this;
            if (target.classList.contains("swfl-leftControl")) action = "move";
            if (target.classList.contains("swfl-rightControl")) action = "view";

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

            // record timestamp so this event can be cancelled
            const timestamp_ms = Date.now();
            
            uiState.screen.pressed[id] = { index: uiState.total, position: { ctrlX, ctrlY }, rect, action, timestamp_ms};
            uiState.total++;
        }
    }

    function pressMove(ev)
    {
        let touches = ev.changedTouches || [ev];
        for (let touch of touches){
            let id = touch.identifier ? touch.identifier : "mouse";
            if (uiState.screen.pressed[id]) {
                ev.preventDefault();
                const rect = uiState.screen.pressed[id].rect;
          
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
                
                uiState.screen.pressed[id].index = uiState.total;
                uiState.screen.pressed[id].position = { ctrlX, ctrlY };
                uiState.total++;
            }
        }
        // if we have pointer lock, we should also add events for that
        if (uiState.screen.pointerLocked)
        {
            let ctrlY = 0.0;
            let ctrlX = 0.0;
            const timestamp_ms = Date.now(); // ms
            if (uiState.screen.pressed["pointerlock"])
            {
                const prevTimestamp_ms = uiState.screen.pressed["pointerlock"].timestamp_ms;
                // browser sometimes gives multiple move events per ms (impressive!)
                // so we add 1 here as a lazy hack to avoid NaNs when computing the move rate
                const deltaT_s = (1 + timestamp_ms - prevTimestamp_ms) / 1000.0;
                ctrlY = -ev.movementX / deltaT_s * config.pointerLockedRadiansPerPixel;
                ctrlX = -ev.movementY / deltaT_s * config.pointerLockedRadiansPerPixel;
            }

            const action = "view";
            const rect = this.getBoundingClientRect();
            uiState.screen.pressed["pointerlock"] = { index: uiState.total, position: { ctrlX, ctrlY }, rect, action, timestamp_ms };
            uiState.total++;
        } else {
            delete uiState.screen.pressed["pointerlock"];
        }
    }


    function pressUp(ev)
    {
        let touches = ev.changedTouches || [ev];
        for (let touch of touches) {
            let id = touch.identifier ? touch.identifier : "mouse";
            delete uiState.screen.pressed[id];
        }
    }

    function addDefaultControlElements(el) {
        el.appendChild(ui.styleEl);
        el.appendChild(ui.leftControlEl);
        el.appendChild(ui.rightControlEl);
    }

    function updateControlElements() {
        core.renderStateToUI(state, config, uiState, ui);
    }

    // public API
    return {
        util,
        step,
        state,
        uiState,
        config,
        addDefaultEventListeners,
        addDefaultControlElements,
        updateControlElements,
    };
}
