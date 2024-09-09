// TODO: this file is a total mess omg it's just here to test the controls

const vs = `

precision mediump float;
attribute vec2 coords;

void main(void) {
    gl_Position = vec4(coords.xy, 0.0, 1.0);
}

`;

const fs = `
#define M_PI 3.14159265
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
// screen width and height
uniform float width;
uniform float height;
// camera position and orientation
uniform float x;
uniform float y;
uniform float z;
uniform float roll;
uniform float pitch;
uniform float yaw;

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

// random output in (-1, 1) 
vec3 rand(vec3 vec) {
    vec3 hashed = vec3(
        hash(dot(vec, vec3(127.1, 311.7, 74.7))),
        hash(dot(vec, vec3(269.5, 183.3, 246.1))),
        hash(dot(vec, vec3(113.5, 271.9, 124.6)))
    );
    
    hashed = fract(sin((hashed + vec) * 4.1414) * 43758.5453);
    return 2.0 * hashed - 1.0;
}


float traceWall(inout vec3 pos, inout vec3 ray, inout vec3 rgb, inout vec3 rng)
{
    // we'll only populate these once. depth testing!
    float outK = -1.0;
    vec3 outPos = pos;
    vec3 outRay = ray;
    vec3 outRgb = vec3(1.0, 1.0, 1.0);

    float wallHeight_m = 5.0;
    float sepLength_m = 3.0;
    // solve for ray-wall intersection with front wall
    // 5.00 = p.x + k * r.x
    // 0 < p.z + k * r.z < 10.0
    float kFront = (5.0-pos.x) / (ray.x + 1e-5);
    float hitZ = pos.z + kFront * ray.z;
    if (kFront > 0.0 && (0.0 < hitZ) && (hitZ < wallHeight_m))
    {
        outK = kFront;
        outPos = pos + kFront * ray;
        outRay = normalize(ray + abs(ray.x) * rng);
        if (outRay.x > 0.0) {
            outRay.x = -outRay.x;
        }
        outRgb = vec3(0.95, 0.95, 0.95);
    }
    // solve for intersection with rear wall
    float kRear = (-5.0-pos.x) / (ray.x + 1e-5);
    hitZ = pos.z + kRear * ray.z;
    if (kRear > 0.0 && (outK < 0.0 || kRear < outK) && (0.0 < hitZ) && (hitZ < wallHeight_m))
    {
        outK = kRear;
        outPos = pos + kRear * ray;
        outRay = normalize(ray + abs(ray.x) * rng);
        if (outRay.x < 0.0) {
            outRay.x = -outRay.x;
        }
        outRgb = vec3(0.95, 0.95, 0.95);
    }
    // solve for intersection with room separators
    // TODO: do this parameterically, for loop was a terrible mistake
    for (int idx = 1; idx < 6; idx++)
    {
        int i = idx / 2 * (2 * (idx - 2 * (idx / 2)) - 1);
        for (int j = -1; j <= 1; j +=2)
        {
            float wallY = float(i + int(pos.y / 10.0)) * 10.0 - 5.0 + float(j) * 0.5;
            float kSep = -(pos.y - wallY) / (ray.y + 1e-5);
            vec3 hit = pos + kSep * ray;
            if (kSep > 0.0 && (outK < 0.0 || kSep < outK) && hit.z > 0.0 && hit.z < wallHeight_m && hit.x < sepLength_m)
            {
                // hit on side walls
                outRay = normalize(rng);
                if (outRay.y * (hit.y - pos.y) > 0.0)
                {
                    outRay.y = -outRay.y;
                }
                outRgb = vec3(0.95, 0.95, 0.95);
                if (hit.x < -4.99)
                {
                    // corner shadows
                    outRgb *= 0.95;
                }
                // edge highlights
                if (hit.x > 2.99) {
                    outRay = normalize(-ray + 0.1 * rng);
                }
                outPos = hit;
                outK = kSep;
            }
        }
        // check the little bits by the separators ugh
        float sepYStart = float(i + int(pos.y / 10.0)) * 10.0 - 5.0 - 0.5;
        float sepYEnd = float(i + int(pos.y / 10.0)) * 10.0 - 5.0 + 0.5;
        // separator intersection
        float kSep = (sepLength_m-pos.x) / (ray.x + 1e-5);
        vec3 hit = pos + kSep * ray;
        if (hit.z >0.0 && hit.z < wallHeight_m && kSep > 0.0 && (outK <0.0 || kSep < outK) && sepYStart < hit.y && hit.y < sepYEnd)
        {
            outK = kSep;
            outPos = hit;
            outRay = normalize(ray + abs(ray.x) * rng);
            // edge highlights again
            if (hit.y <sepYStart + 0.01 || hit.y > sepYEnd - 0.01) {
                outRay = normalize(-ray + 0.1 * rng);
            }
            if (outRay.x < 0.0) {
                outRay.x = -outRay.x;
            }
            outRgb = vec3(0.95, 0.95, 0.95);
        }
    }
    if (0.24 < outPos.z && outPos.z < 0.25 || outPos.z < 0.01 || (outPos.z > 4.99))
    {
        outRgb *= 0.95;
    }
    if (0.23 < outPos.z && outPos.z < 0.24)
    {
        outRay = normalize(-ray + 0.1 * rng);
    }
    pos = outPos;
    ray = outRay;
    rgb *= outRgb;
    return outK;
}


float traceGround(inout vec3 pos, inout vec3 ray, inout vec3 rgb, inout vec3 rng)
{
    if (pos.z > 0.0 && ray.z < 0.0)
    {
        // ray hits the ground
        float k = -pos.z / ray.z;
        pos = pos + k * ray;
        float sharpness = 100.0;
        float grid = clamp(sharpness * sin(5.0 * pos.x), -1.0, 1.0) * clamp(sharpness * sin(5.0 * pos.y), -1.0, 1.0);
        float gridNonEdge = (abs(clamp(sharpness * sin(2.0 * pos.x * M_PI), -1.0, 1.0))) * (abs(clamp(sharpness * sin(2.0 * pos.y * M_PI), -1.0, 1.0)));
        float gridBorder = clamp(1.0 - (abs(clamp(0.2*sharpness * sin(2.0 * pos.x * M_PI), -1.0, 1.0))) * (abs(clamp(0.2 * sharpness * sin(2.0 * pos.y * M_PI), -1.0, 1.0))), 0.0, 1.0);
        vec3 color = vec3(0.9, 0.9, 0.9) * (0.1 + 0.9 * gridNonEdge);
        float roughness = 0.1 * (1.0 - gridBorder * gridNonEdge);

        // fake border geometry
        ray = gridBorder * gridNonEdge * -ray + (1.0 - gridBorder * gridNonEdge) * ray;
        // diffuse
        ray = (1.0 - roughness) * ray + roughness * rng;
        //color = gridBorder * vec3(1.0, 0.0, 0.0) + (1.0 - gridBorder) * color;
        if (ray.z < 0.0)
        {
            // update direction
            ray.z *= -1.0;
        }
        ray = normalize(ray);

        rgb = rgb * color;
        return k;
    }
    return -1.0;
}

float traceCeiling(inout vec3 pos, inout vec3 ray, inout vec3 rgb, inout vec3 rng)
{
    if (ray.z > 0.0)
    {
        float k = (5.0-pos.z) / ray.z;
        pos = pos + k * ray;
        ray = rng;
        if (ray.z > 0.0)
        {
            // update direction
            ray.z = -ray.z;
        }
        ray = normalize(ray);
        rgb = rgb * vec3(0.9, 0.9, 0.9);
        float sharpness = 10.0;
        float lightStrength = min(min(clamp(sharpness * cos(5.0 * pos.y * M_PI), 0.0, 1.0), clamp(200.0 * cos(0.2 * pos.y * M_PI), 0.0, 1.0)), min(clamp(sharpness * (pos.x + 4.5), 0.0, 1.0), clamp(sharpness * (2.0 - pos.x), 0.0, 1.0)));
        rgb = lightStrength * vec3(1.0, 1.0, 1.0) + (1.0 - lightStrength) * rgb;
        pos.z = lightStrength * 10000.0 + (1.0 - lightStrength) * pos.z;
        return k;
    }
    return -1.0;
}


// trace an (inverse) ray through the scene starting from position pos
// in direction ray, and with accumulated color rgb.
// results in modifying each value 
// * pos is updated to the hit position
// * ray is updated to the direction after hit
// * rgb is updated based on the hit color
// * rng is updated randomly

void trace(inout vec3 pos, inout vec3 ray, inout vec3 rgb, inout vec3 rng)
{
    float k = -1.0;
    if (pos.z >= 1000.0) {
        // skip more bounces for the lights I guess? not sure we really need this
        return;
    }
    k = traceWall(pos, ray, rgb, rng);
    if (k < 0.0) k = traceGround(pos, ray, rgb, rng);
    if (k < 0.0) k = traceCeiling(pos, ray, rgb, rng);
    ray = normalize(ray);
    rng = rand(rng);
}

vec3 computeRayDirection(float ndcX, float ndcY, float aspectRatio, float fov) {
    ndcX *= aspectRatio;
    // Apply the field of view to the ray direction calculation
    float tanFov = tan(radians(fov * 0.5));

    // Calculate the ray direction in the new coordinate system
    vec3 rayDir = normalize(vec3(1.0, -ndcX * tanFov, ndcY * tanFov));
    
    return rayDir;
}

void main() {
    vec2 st = gl_FragCoord.xy;
    vec3 rayDirection = computeRayDirection(2.0 * st.x/width - 1.0, 2.0 * st.y / height - 1.0, width/height, 75.0);
    // rotate by pitch
    rayDirection = vec3(
        rayDirection.x * cos(pitch)  - rayDirection.z * sin(pitch),
        rayDirection.y,
        rayDirection.x * sin(pitch) + rayDirection.z * cos(pitch)
    );
    // rotate by yaw
    rayDirection = vec3(
        rayDirection.x * cos(yaw) - rayDirection.y * sin(yaw),
        rayDirection.x * sin(yaw) + rayDirection.y * cos(yaw),
        rayDirection.z
    );
    vec3 rgbAverage = vec3(0.0, 0.0, 0.0);
    const int nSamples = 5;
    const int nBounces = 3;
    vec3 rng = rand(vec3(st, u_time));
    for (int t = 0; t < nSamples; t++)
    {
        // original position of this ray
        vec3 pos = vec3(x, y, z + 1.7);
        vec3 ray = rayDirection + 0.001 * rng;
        vec3 rgb = vec3(1, 1, 1);
        for (int i = 0; i < nBounces; i++)
        {
            // trace the ray
            trace(pos, ray, rgb, rng);
        }
        rgbAverage += rgb / float(nSamples);
        rng = rand(rng);
    }
    gl_FragColor = vec4(rgbAverage, 1);
}
`;

function loadShader(gl, ss, type)
{
    const s = gl.createShader(type);
    gl.shaderSource(s, ss);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    {
        console.error(gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
    }
    return s;
}

function compile(gl)
{
    const p = gl.createProgram();
    gl.attachShader(p, loadShader(gl, vs, gl.VERTEX_SHADER));
    gl.attachShader(p, loadShader(gl, fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    {
        console.error(gl.getProgramInfoLog(p));
        gl.deleteProgram(p);
        return null;
    }
    return p;
}

const swfl = Strafewafel();

function main() {
    // set up a strafewafel controller
    const swflContainer = document.querySelector("#demo-controls");

    // connect it to the page elements
    swfl.addDefaultEventListeners(document.body);
    swfl.addDefaultControlElements(swflContainer);

    // manually set initial state
    swfl.state.position_m.x = 4.0;
    swfl.state.view_r.yaw = Math.PI;

    const canvas = document.querySelector("#demo-canvas");
    const gl = canvas.getContext("webgl");

    const p = compile(gl);
    gl.useProgram(p);
    function fixCanvasShape() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    }
    fixCanvasShape();
    window.addEventListener("resize", fixCanvasShape);

    let array = new Float32Array([-1,  3, -1, -1, 3, -1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
    let al = gl.getAttribLocation(p, "coords");
    gl.vertexAttribPointer(al, 2 /*components per vertex */, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(al);


    var tl = gl.getUniformLocation(p, "u_time");
    var width = gl.getUniformLocation(p, "width");
    var height = gl.getUniformLocation(p, "height");
    var xVar = gl.getUniformLocation(p, "x");
    var yVar = gl.getUniformLocation(p, "y");
    var zVar = gl.getUniformLocation(p, "z");
    var rollVar = gl.getUniformLocation(p, "roll");
    var pitchVar = gl.getUniformLocation(p, "pitch");
    var yawVar = gl.getUniformLocation(p, "yaw");

    let then = 0;
    // extremely sophisticated collision detection
    function isInWall(pos) {
        const margin = 0.01;
        if (pos.x > 5.0 - margin  || pos.x < -5.0 + margin) return true;
        if (pos.x < 3.0 + margin)
        {
            return Math.abs(pos.y) % 10 > 4.5 - margin && Math.abs(pos.y) % 10 < 6.5 + margin;
        }
        return false;
    }
    function step(now) {
        const dt_s = (now - then) / 1000.0;
        then = now;

        let prevPos = JSON.parse(JSON.stringify(swfl.state.position_m));
        // update the controller state
        swfl.step(dt_s);
        swfl.updateControlElements();

        // collision detection in action
        if (isInWall(swfl.state.position_m))
        {
            if (!isInWall({x:swfl.state.position_m.x, y:prevPos.y}))
            {
                swfl.state.position_m.y = prevPos.y;
            } else if (!isInWall({x:prevPos.x, y:swfl.state.position_m.y}))
            {
                swfl.state.position_m.x = prevPos.x;
            } else {
                swfl.state.position_m = prevPos;
            }
        }

        // update the rendering
        gl.uniform1f(tl, now / 1000.0);
        gl.uniform1f(width, canvas.width);
        gl.uniform1f(height, canvas.height);
        gl.uniform1f(xVar, swfl.state.position_m.x);
        gl.uniform1f(yVar, swfl.state.position_m.y);
        gl.uniform1f(zVar, 0.0);
        gl.uniform1f(rollVar, 0.0);
        gl.uniform1f(pitchVar, swfl.state.view_r.pitch);
        gl.uniform1f(yawVar, swfl.state.view_r.yaw);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

window.onload = main;
