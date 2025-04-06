// --- Global Variables ---
let scene, camera, renderer, controls;
let graphData = { nodes: [], edges: [] };
let nodeMeshes = [];
let edgeMeshes = [];
let raycaster, mouse;
let highlightedElements = { nodes: [], edges: [] }; // To store highlighted objects
let activeHighlightTimeouts = []; // Stores IDs of active animation timeouts
let adjacencyList = new Map(); // Store adjacency list for reuse
let activeLightningBolts = []; // Store active lightning bolt groups

// Post-processing variables
let composer, bloomPass;
let bloomLayer;

// --- DOM Elements ---
const container = document.getElementById('container');
const topologyTypeSelect = document.getElementById('topologyType');
const paramsContainer = document.getElementById('paramsContainer');
const diameterSpan = document.getElementById('diameter');
const nodeCountSpan = document.getElementById('nodeCount');
const edgeCountSpan = document.getElementById('edgeCount');
const avgPathLengthSpan = document.getElementById('avgPathLength'); // Add reference to new span

// --- Constants ---
const NODE_RADIUS = 0.8;
const NODE_SEGMENTS = 16;
const EDGE_COLOR = 0xaaaaaa;
const NODE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x00aaff, roughness: 0.5, metalness: 0.2 });
const EDGE_MATERIAL = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
const WRAP_EDGE_COLOR = 0xffaa00; // Orange for wrap edges (choose any contrasting color)
const WRAP_EDGE_MATERIAL = new THREE.LineBasicMaterial({ color: WRAP_EDGE_COLOR });

// --- Highlighting Constants ---
const HIGHLIGHT_NODE_COLOR = 0xff4444; // Red for source/target
const PATH_NODE_COLOR = 0xffaa00;     // Orange for intermediate path nodes
const PATH_EDGE_COLOR = 0xffdd44;     // Yellow for path edges

// Create highlight materials once
const HIGHLIGHT_NODE_MATERIAL = new THREE.MeshStandardMaterial({ color: HIGHLIGHT_NODE_COLOR, roughness: 0.5, metalness: 0.2 });
const PATH_NODE_MATERIAL = new THREE.MeshStandardMaterial({ color: PATH_NODE_COLOR, roughness: 0.5, metalness: 0.2 });
const PATH_EDGE_MATERIAL = new THREE.LineBasicMaterial({ color: PATH_EDGE_COLOR });

// Keep original materials accessible
const ORIGINAL_NODE_MATERIAL = NODE_MATERIAL;
const ORIGINAL_EDGE_MATERIAL = EDGE_MATERIAL;
const ORIGINAL_WRAP_EDGE_MATERIAL = WRAP_EDGE_MATERIAL; // If using wrap edges

// Map to quickly find meshes/lines by ID or edge key
let nodeMeshMap = new Map();
let edgeMeshMap = new Map();

// --- Initialization ---
function init() {
    setupThreeJS();
    setupUIEventListeners();
    updateParameterInputs(); // Initial parameter fields
    generateGraphAndMetrics(); // Generate initial graph
    animate();
}

// --- Three.js Setup ---
function setupThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.z = 30; // Adjusted initial zoom

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // --- Raycasting Setup ---
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // --- Event Listeners ---
    renderer.domElement.addEventListener('click', onNodeClick, false);
    // Add listener to clear highlights on background click
    renderer.domElement.addEventListener('pointerdown', onPointerDown, false); // Use pointerdown for potentially easier background detection

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5).normalize();
    scene.add(directionalLight);

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false; // Optional: restrict panning

    // Resize Listener
    window.addEventListener('resize', onWindowResize, false);

    // Post-processing setup - initialize after renderer is created
    setupPostProcessing();
}

function setupPostProcessing() {
    // Create a bloom layer
    bloomLayer = new THREE.Layers();
    bloomLayer.set(1); // Use layer 1 for objects that should bloom
    
    // Create effect composer
    composer = new THREE.EffectComposer(renderer);
    
    // Add the main render pass
    const renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    // Add bloom pass for the glow effect
    bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(container.clientWidth, container.clientHeight),
        1.5,  // Bloom strength
        0.4,  // Bloom radius
        0.85  // Bloom threshold
    );
    composer.addPass(bloomPass);
}

// --- UI & Event Handling ---
function setupUIEventListeners() {
    // 1. Update on topology dropdown change
    topologyTypeSelect.addEventListener('change', () => {
        updateParameterInputs(); // Rebuild inputs first
        generateGraphAndMetrics(); // Then generate
    });

    // 2. Use event delegation with 'change' for parameter inputs (numbers + checkbox)
    paramsContainer.addEventListener('change', (event) => {
        if (event.target && event.target.nodeName === 'INPUT' &&
            (event.target.type === 'number' || event.target.type === 'checkbox')) {
            generateGraphAndMetrics();
        }
    });

    // Optional: Add 'input' listener *only* for number inputs if you want instant updates
    // while typing in number fields, but be mindful of performance.
    // paramsContainer.addEventListener('input', (event) => {
    //     if (event.target && event.target.nodeName === 'INPUT' && event.target.type === 'number') {
    //         // Consider debouncing generateGraphAndMetrics() here
    //         generateGraphAndMetrics();
    //     }
    // });
}

function updateParameterInputs() {
    paramsContainer.innerHTML = ''; // Clear existing parameters
    const type = topologyTypeSelect.value;
    let nodesInput = null; // Keep track if node input exists

    if (type === 'ring') {
        addNumericInput('nodes', 'Nodes:', 12, 3, 100);
        addNumericInput('skip', 'Skip Dist:', 1, 1, 50);
        nodesInput = document.getElementById('nodes'); // Get reference
    } else if (type === 'mesh' || type === 'torus') {
        // Mesh and Torus use the same base parameters
        addNumericInput('rows', 'Rows:', 4, 2, 20);
        addNumericInput('cols', 'Cols:', 5, 2, 20);

        if (type === 'torus') {
            addCheckboxInput('use3DLayout', 'Use 3D Layout:', false); // Default to 2D+Style view
        }
    } else if (type === 'hypercube') {
        // Dimension 'd' for d-dimensional hypercube
        // Limit max dimension for practical visualization/performance (e.g., 6 -> 64 nodes)
        addNumericInput('dimension', 'Dimension (d):', 3, 1, 6);
    }
    // Add else if blocks for other topologies

    // Dynamic skip limit adjustment for rings
    const skipInput = document.getElementById('skip');
    if (nodesInput && skipInput) {
        const updateMaxSkip = () => {
            const nValue = nodesInput.value;
            if (nValue) {
                const n = parseInt(nValue, 10);
                const currentMax = Math.max(1, Math.floor(n / 2));
                if (parseInt(skipInput.max) !== currentMax) {
                    skipInput.max = currentMax;
                }
                if (parseInt(skipInput.value, 10) > currentMax) {
                    skipInput.value = currentMax;
                    generateGraphAndMetrics(); // Regenerate if value clamped
                }
            }
        };
        nodesInput.removeEventListener('input', updateMaxSkip); // Remove any existing listener
        nodesInput.addEventListener('input', updateMaxSkip); // Use input for immediate max update
        updateMaxSkip();
    }
}

function addNumericInput(id, labelText, defaultValue, min, max) {
    const div = document.createElement('div');
    // --- Style the container div ---
    div.style.display = 'flex';         // Use flexbox to arrange items horizontally
    div.style.alignItems = 'center';    // Vertically align label text and input box
    div.style.justifyContent = 'space-between'; // Put space between label and input
    div.style.marginBottom = '10px';    // Add some spacing below this input row

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    // Optional: Give label a fixed width for consistent alignment across rows
    label.style.width = '120px'; // Adjust width as needed
    // label.style.marginRight = '10px'; // Add space if using fixed width
    // if using fixed label width, change justify-content:
    div.style.justifyContent = 'flex-start';


    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.value = defaultValue;
    input.min = min;
    input.max = max;
    // Optional: Limit input width
    // input.style.width = '60px';

    div.appendChild(label);
    div.appendChild(input);
    paramsContainer.appendChild(div);
}

// Helper function to add checkbox input
function addCheckboxInput(id, labelText, defaultChecked) {
    const div = document.createElement('div');
    div.style.display = 'flex'; // Use flexbox for alignment
    div.style.alignItems = 'center';
    div.style.marginBottom = '10px'; // Consistent spacing

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = defaultChecked;
    input.style.marginRight = '8px'; // Space between checkbox and label
    input.style.width = 'auto'; // Override potential inherited width

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    label.style.width = 'auto'; // Override fixed width from numeric inputs
    label.style.marginBottom = '0'; // Remove bottom margin if set elsewhere
    label.style.fontWeight = 'normal'; // Normal weight for checkbox label


    div.appendChild(input); // Checkbox first
    div.appendChild(label);
    paramsContainer.appendChild(div);
}

function onPointerDown(event) {
    // Check if the click was on the background (not on a node)
    mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(nodeMeshes);

    if (intersects.length === 0) {
        // Clicked on background
        clearHighlights();
    }
}

function onNodeClick(event) {
    event.preventDefault();

    mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(nodeMeshes); // Check intersection with node meshes

    if (intersects.length > 0) {
        const clickedMesh = intersects[0].object;
        if (clickedMesh.userData && clickedMesh.userData.nodeId !== undefined) {
            const sourceNodeId = clickedMesh.userData.nodeId;
            console.log(`Clicked Node ID: ${sourceNodeId}`);
            highlightDiameterPath(sourceNodeId);
        }
    }
    // Note: We don't clear highlights here; that's handled by onPointerDown hitting the background
}

// --- Graph Generation & Metrics ---
function generateGraphAndMetrics() {
    clearVisualization();

    const type = topologyTypeSelect.value;
    let params = {};
    let use3DLayout = false; // Default layout choice for Torus

    // Read parameter values from the dynamically created inputs
    paramsContainer.querySelectorAll('input').forEach(input => {
        if (input.type === 'number') {
            let value = parseInt(input.value, 10);
            if (isNaN(value)) {
                const minVal = parseInt(input.min);
                value = isNaN(minVal) ? 1 : minVal;
                console.warn(`Invalid input for ${input.id}, using fallback value: ${value}`);
                input.value = value;
            }
            params[input.id] = value;
        } else if (input.type === 'checkbox' && input.id === 'use3DLayout') {
            // **** READ CHECKBOX STATE ****
            use3DLayout = input.checked;
        }
    });

    // --- Generate graph data structure ---
    // (Generation logic remains the same, based only on type and params like rows/cols/skip)
    if (type === 'ring') {
        graphData = generateRing(params.nodes || 12, params.skip || 1);
    } else if (type === 'mesh') {
        graphData = generateMesh(params.rows || 4, params.cols || 5);
    } else if (type === 'torus') {
        graphData = generateTorus(params.rows || 4, params.cols || 5);
    } else if (type === 'hypercube') { // **** ADD THIS ELSE IF ****
        graphData = generateHypercube(params.dimension || 3); // Default to 3D cube
    }
    // --- End Generation ---

    // --- Calculate Adjacency List (and store it) ---
    adjacencyList = new Map();
    graphData.nodes.forEach(node => adjacencyList.set(node.id, []));
    graphData.edges.forEach(edge => {
        // Ensure both directions are added for BFS
        adjacencyList.get(edge.source)?.push(edge.target);
        adjacencyList.get(edge.target)?.push(edge.source);
    });

    // Calculate Metrics
    // Pass adjacencyList to the metrics function if needed, or have it use the global one
    const metrics = calculateGraphMetrics(graphData, adjacencyList); // Modify if necessary

    // Update UI
    diameterSpan.textContent = metrics.diameter === Infinity ? 'Disconnected' : metrics.diameter;
    avgPathLengthSpan.textContent = metrics.avgPathLength === Infinity ? 'Disconnected' : metrics.avgPathLength;
    nodeCountSpan.textContent = graphData.nodes.length;
    edgeCountSpan.textContent = graphData.edges.length;


    // Visualize the new graph
    if (graphData.nodes.length > 0) {
        // **** PASS LAYOUT CHOICE TO VISUALIZE FUNCTION ****
        visualizeGraph(graphData, type, use3DLayout, params);
    }
}

// --- Topology Generation Functions ---
function generateRing(n, skip = 1) {
    const nodes = [];
    const edges = [];
    if (n < 1) return { nodes, edges };

    // Clamp skip distance to valid range [1, floor(n/2)]
    const maxSkip = Math.max(1, Math.floor(n / 2));
    const validSkip = Math.max(1, Math.min(skip, maxSkip));
    if (skip !== validSkip) {
        console.warn(`Provided skip ${skip} adjusted to ${validSkip} for n=${n}`);
    }


    for (let i = 0; i < n; i++) {
        nodes.push({ id: i });
    }

    if (n <= 1) return { nodes, edges }; // No edges for 0 or 1 node

    const addedEdges = new Set(); // Use a Set to prevent duplicate edges

    // Helper function to add edges consistently (u < v)
    function addEdge(u, v) {
        const min = Math.min(u, v);
        const max = Math.max(u, v);
        const edgeKey = `${min}-${max}`; // Unique key for the edge pair

        // Check if this edge pair has already been added
        if (!addedEdges.has(edgeKey) && min !== max) { // Ensure no self-loops
            edges.push({ source: u, target: v }); // Can use u,v directly here
            addedEdges.add(edgeKey);
        }
    }

    // Add base ring edges (+/- 1 distance)
    for (let i = 0; i < n; i++) {
        addEdge(i, (i + 1) % n);
    }

    // Add skip edges (+/- skip distance) if skip > 1
    // Only add if the skip distance is different from the base ring distance (1)
    if (validSkip > 1 && n >= 3) { // Need at least 3 nodes for skip > 1
        for (let i = 0; i < n; i++) {
            addEdge(i, (i + validSkip) % n);
            // The connection (i - skip) is implicitly covered by iterating through all i
            // E.g., adding edge (0, skip) also covers the connection for node 'skip' back to 0.
        }
    }

    return { nodes, edges };
}

function generateMesh(rows, cols) {
    const nodes = [];
    const edges = [];
    if (rows < 1 || cols < 1) return { nodes, edges };
    let idCounter = 0;
    const nodeGrid = []; // Helper to map (r, c) to id

    for (let r = 0; r < rows; r++) {
        nodeGrid[r] = [];
        for (let c = 0; c < cols; c++) {
            const nodeId = idCounter++;
            nodes.push({ id: nodeId, row: r, col: c }); // Store row/col for layout
            nodeGrid[r][c] = nodeId;

            // Connect to previous node in the same row (left)
            if (c > 0) {
                edges.push({ source: nodeId, target: nodeGrid[r][c - 1] });
            }
            // Connect to previous node in the same column (up)
            if (r > 0) {
                edges.push({ source: nodeId, target: nodeGrid[r - 1][c] });
            }
        }
    }
    return { nodes, edges };
}

function generateTorus(rows, cols) {
    const nodes = [];
    const edges = [];
    // Basic validation
    if (rows < 1 || cols < 1) return { nodes, edges };
    // Torus needs at least 2 in a dimension for wrap-around to differ from mesh edge cases
    // Though technically works with 1 row/col (becomes a ring).

    // Create nodes and store row/col for layout/reference
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const nodeId = r * cols + c; // Calculate unique ID: row major order
            nodes.push({ id: nodeId, row: r, col: c });
        }
    }

    const addedEdges = new Set(); // Use Set to prevent duplicate edges like (A,B) and (B,A)

    // Helper to get node ID at specific (r, c) with wrap-around
    function nodeAt(r, c) {
        const wrappedRow = (r + rows) % rows; // Modulo for row wrap-around
        const wrappedCol = (c + cols) % cols; // Modulo for column wrap-around
        return wrappedRow * cols + wrappedCol; // Calculate ID
    }

    // Helper to add edges uniquely
    function addEdge(u, v) {
        const min = Math.min(u, v);
        const max = Math.max(u, v);
        const edgeKey = `${min}-${max}`;
        if (!addedEdges.has(edgeKey) && min !== max) { // Avoid self-loops if rows/cols=1
            edges.push({ source: u, target: v });
            addedEdges.add(edgeKey);
        }
    }

    // Iterate through each node and connect to neighbors using wrap-around logic
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const currentNodeId = nodeAt(r, c); // ID of the current node

            // Connect to the node 'below' (r+1) with wrap-around
            if (rows > 1) { // Avoid self-loop if only 1 row
                const neighborBelowId = nodeAt(r + 1, c);
                addEdge(currentNodeId, neighborBelowId);
            }

            // Connect to the node 'to the right' (c+1) with wrap-around
            if (cols > 1) { // Avoid self-loop if only 1 col
                const neighborRightId = nodeAt(r, c + 1);
                addEdge(currentNodeId, neighborRightId);
            }

            // Connections 'up' and 'left' are automatically handled when
            // the loop reaches those nodes and connects them 'down' and 'right'.
        }
    }

    return { nodes, edges };
}

function generateHypercube(d) {
    const nodes = [];
    const edges = [];
    // Basic validation
    if (d < 0) d = 0; // 0-cube is a single point
    if (d > 10) {
        console.warn(`Hypercube dimension ${d} too large, may cause performance issues. Clamping to 10.`);
        d = 10; // Limit for practical reasons (1024 nodes)
    }


    const n = Math.pow(2, d); // Total number of nodes

    // --- Generate Nodes ---
    for (let i = 0; i < n; i++) {
        // Store the ID and its binary representation (useful for layout)
        // Pad with leading zeros to ensure fixed length d
        nodes.push({
            id: i,
            binary: i.toString(2).padStart(d, '0')
        });
    }

    // --- Generate Edges ---
    // Nodes are connected if their binary representations differ by exactly one bit
    if (d > 0) { // No edges if d=0
        const addedEdges = new Set(); // To prevent duplicates like i->j and j->i

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < d; j++) {
                // Calculate neighbor by flipping the j-th bit (using XOR)
                const neighborId = i ^ (1 << j); // (1 << j) creates a mask like 00100

                // Ensure neighborId is valid (should always be within 0 to n-1)
                // Add edge only once (e.g., if source < target)
                const min = Math.min(i, neighborId);
                const max = Math.max(i, neighborId);
                const edgeKey = `${min}-${max}`;

                if (!addedEdges.has(edgeKey)) {
                    edges.push({ source: i, target: neighborId });
                    addedEdges.add(edgeKey);
                }
            }
        }
    }

    return { nodes, edges };
}

// --- Metric Calculation Functions ---
function calculateGraphMetrics(graph, adj) {
    const n = graph.nodes.length;
    // Handle trivial cases
    if (n <= 1) return { diameter: 0, avgPathLength: 0, isConnected: true };

    let maxDistance = 0;         // Stores the diameter
    let totalPathLengthSum = 0;  // Sum of all shortest paths
    let reachablePairsCount = 0; // Count of reachable node pairs (excluding self)
    let isConnected = true;      // Connectivity flag
    let nodesInFirstComponent = 0; // Size of component found by first BFS

    for (let i = 0; i < n; i++) {
        const startNodeId = graph.nodes[i].id;
        const { distances } = bfs(startNodeId, adj, graph.nodes); // Only need distances here
        let currentMax = 0;        // Max distance from this start node
        let reachableCount = 0;    // Nodes reachable from this start node

        distances.forEach((dist, targetNodeId) => {
            if (dist !== Infinity) {
                reachableCount++;
                // For ASPL, only sum paths to other nodes (dist > 0)
                if (dist > 0) {
                    totalPathLengthSum += dist;
                    reachablePairsCount++;
                }
                currentMax = Math.max(currentMax, dist); // Update max distance from startNode
            }
        });

        // Connectivity Check: Compare reachable nodes count
        if (i === 0) {
            nodesInFirstComponent = reachableCount;
            if (nodesInFirstComponent < n) {
                isConnected = false; // Disconnected if first BFS doesn't reach all nodes
                // console.warn(`Graph appears disconnected. Component size: ${nodesInFirstComponent}/${n}`);
            }
        } else if (isConnected && reachableCount !== nodesInFirstComponent) {
            // If previously thought connected, but this BFS reaches a different number,
            // it confirms disconnection (handles cases where first node was isolated).
            isConnected = false;
            console.warn(`Graph confirmed disconnected. Reachable count mismatch: ${reachableCount} vs ${nodesInFirstComponent}`);
        }

        // Update overall maximum distance found so far (Diameter)
        maxDistance = Math.max(maxDistance, currentMax);
    }

    // Determine final Diameter and ASPL
    const diameter = isConnected ? maxDistance : Infinity;

    // Calculate ASPL only if connected and pairs exist
    const avgPathLength = (isConnected && reachablePairsCount > 0)
        ? (totalPathLengthSum / reachablePairsCount) // Sum included A->B and B->A, Count included A->B and B->A
        : Infinity;

    // For undirected graphs, the sum and count are doubled (A->B and B->A are both counted).
    // The division totalPathLengthSum / reachablePairsCount correctly gives the average.

    return {
        diameter: diameter,
        // Format ASPL to a reasonable number of decimal places
        avgPathLength: avgPathLength === Infinity ? Infinity : parseFloat(avgPathLength.toFixed(3)),
        isConnected: isConnected
    };
}


// --- BFS Helper function (remains the same) ---
function bfs(startNodeId, adj, allNodes) {
    const distances = new Map();
    const predecessors = new Map(); // To store path predecessors
    allNodes.forEach(node => {
        distances.set(node.id, Infinity);
        predecessors.set(node.id, null); // Initialize predecessors
    });
    const queue = [];

    distances.set(startNodeId, 0);
    queue.push(startNodeId);

    let head = 0;
    while (head < queue.length) {
        const u = queue[head++];
        const neighbors = adj.get(u) || [];

        for (const v of neighbors) {
            if (distances.get(v) === Infinity) {
                distances.set(v, distances.get(u) + 1);
                predecessors.set(v, u); // Set predecessor for path reconstruction
                queue.push(v);
            }
        }
    }
    return { distances, predecessors };
}


// --- Visualization Functions ---
function clearVisualization() {
    nodeMeshes.forEach(mesh => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        // Material is shared, dispose only once if needed, or manage carefully
    });
    edgeMeshes.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();
        // Material is shared
    });
    nodeMeshes = [];
    edgeMeshes = [];
    // Dispose shared materials if they are no longer needed by any object
    // NODE_MATERIAL.dispose();
    // EDGE_MATERIAL.dispose();
}

// --- Highlighting and Path Finding ---

function clearHighlights() {
    // --- Cancel pending animations ---
    activeHighlightTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    activeHighlightTimeouts = []; // Clear the array

    // Reset node materials
    highlightedElements.nodes.forEach(mesh => {
        // Ensure mesh still exists and hasn't been disposed
        if (mesh && mesh.material) {
            mesh.material = ORIGINAL_NODE_MATERIAL;
        }
    });

    // Reset edge materials/colors
    highlightedElements.edges.forEach(line => {
        line.material = ORIGINAL_EDGE_MATERIAL; // Reset to original material
    });

    highlightedElements = { nodes: [], edges: [] }; // Clear the tracking arrays
    clearActiveLightningBolts(); // Clear active lightning bolts
}

function reconstructPath(source, target, predecessors) {
    const path = [target];
    let current = target;
    let safety = 0; // Prevent infinite loops in case of error
    const maxPathLength = predecessors.size;

    while (current !== source && safety < maxPathLength) {
        const prev = predecessors.get(current);
        if (prev === null || prev === undefined) {
            console.error(`Error reconstructing path: No predecessor found for node ${current}`);
            return null; // Path reconstruction failed
        }
        path.unshift(prev);
        current = prev;
        safety++;
    }

    if (current !== source) {
        console.error(`Error reconstructing path: Loop detected or source not reached.`);
        return null;
    }

    return path; // Array of node IDs from source to target
}

function createAnimatedLightningBolt(source, target, duration = 3000, isPersistent = false) {
    const group = new THREE.Group(); // Group to hold multiple rays
    activeLightningBolts.push(group);

    const rayCount = 5; // Number of rays per lightning bolt
    const bolts = [];

    for (let i = 0; i < rayCount; i++) {
        // Create distinct material for each bolt with controlled glow properties
        const boltMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x88aaff,
            transparent: true,
            opacity: 0.7,
            emissive: 0xffffff,
            emissiveIntensity: 2.0,
            side: THREE.DoubleSide
        });
        
        const points = generateLightningPath(source, target);
        
        // Create a thinner tube geometry for more lightning-like appearance
        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeometry = new THREE.TubeGeometry(
            curve,
            64,  // tubularSegments
            0.1, // radius - reduced for finer bolts
            8,   // radiusSegments 
            false // closed
        );
        
        // Create a mesh for the tube
        const bolt = new THREE.Mesh(tubeGeometry, boltMaterial);
        bolt.layers.enable(1); // Enable bloom layer
        group.add(bolt);
        
        // Store references to the bolt components
        bolts.push({
            bolt: bolt,
            boltGeometry: tubeGeometry,
            boltMaterial: boltMaterial
        });
    }

    scene.add(group);

    // Animate the lightning bolts
    const startTime = performance.now();
    let lastUpdateTime = startTime;
    const updateInterval = 5;

    function animateBolts() {
        const currentTime = performance.now();
        const elapsedTime = currentTime - startTime;
        const timeSinceLastUpdate = currentTime - lastUpdateTime;

        // For non-persistent bolts, remove after duration
        if (!isPersistent && elapsedTime > duration) {
            // Remove the group after the duration
            scene.remove(group);
            bolts.forEach(({ bolt, boltGeometry, boltMaterial }) => {
                boltGeometry.dispose();
                boltMaterial.dispose();
            });
            // Remove from active lightning bolts array
            const index = activeLightningBolts.indexOf(group);
            if (index > -1) {
                activeLightningBolts.splice(index, 1);
            }
            return;
        }

        // Only update the bolts every updateInterval milliseconds
        if (timeSinceLastUpdate > updateInterval) {
            lastUpdateTime = currentTime;
            
            // Update each bolt individually
            for (let i = 0; i < bolts.length; i++) {
                const { bolt, boltGeometry, boltMaterial } = bolts[i];
                
                // Remove old geometry
                group.remove(bolt);
                boltGeometry.dispose();
                
                // Generate new path with more controlled randomness
                const newPoints = generateLightningPath(source, target);
                const newCurve = new THREE.CatmullRomCurve3(newPoints);
                
                // Create new geometry
                const newGeometry = new THREE.TubeGeometry(
                    newCurve,
                    64,  // tubularSegments
                    0.05 + Math.random() * 0.1, // random radius between 0.05 and 0.15
                    8,   // radiusSegments
                    false // closed
                );
                
                // Create new bolt mesh
                const newBolt = new THREE.Mesh(newGeometry, boltMaterial);
                newBolt.layers.enable(1);
                group.add(newBolt);
                
                // Update references
                bolts[i].bolt = newBolt;
                bolts[i].boltGeometry = newGeometry;
                
                // Update material with controlled colors and intensities
                const baseHue = 0.9; // Pinkish-blue color
                const hueVariation = 0.1;
                const hue = (baseHue + (Math.random() * hueVariation - hueVariation/2)) % 1;
                
                boltMaterial.color.setHSL(hue, 1, 0.6);
                boltMaterial.emissive.setHSL(hue, 1, 0.8);
                
                // Control emissive intensity with a sine wave for natural pulsing
                // plus small random variation for flickering
                const pulseFrequency = 0.002; // Controls how fast the pulse happens
                const pulseBase = 1.0 + Math.sin(currentTime * pulseFrequency) * 0.5;
                const flicker = Math.random() * 0.5;
                
                boltMaterial.emissiveIntensity = pulseBase + flicker;
                boltMaterial.needsUpdate = true;
            }
        }

        requestAnimationFrame(animateBolts);
    }

    animateBolts();
    return group;
}

function generateLightningPath(source, target) {
    const points = [];
    const segments = 10; // Number of segments in the lightning bolt
    const sourceVector = new THREE.Vector3(source.x, source.y, source.z);
    const targetVector = new THREE.Vector3(target.x, target.y, target.z);
    const direction = new THREE.Vector3().subVectors(targetVector, sourceVector);
    const segmentLength = direction.length() / segments;
    direction.normalize();

    for (let j = 0; j <= segments; j++) {
        const point = sourceVector.clone().add(direction.clone().multiplyScalar(j * segmentLength));

        // Add randomness to create jagged effect
        if (j > 0 && j < segments) {
            point.x += (Math.random() - 0.5) * segmentLength * 1.5;
            point.y += (Math.random() - 0.5) * segmentLength * 1.5;
            point.z += (Math.random() - 0.5) * segmentLength * 1.5;
        }

        points.push(point);
    }

    // Create a smooth curve using CatmullRomCurve3
    const curve = new THREE.CatmullRomCurve3(points);
    return curve.getPoints(segments * 10); // Increase the number of points for a smoother curve
}

function animatePersistentLightningBolts(pathNodeIds) {
    clearActiveLightningBolts(); // Clear previous lightning bolts

    for (let i = 1; i < pathNodeIds.length; i++) {
        const prevNodeId = pathNodeIds[i - 1];
        const currentNodeId = pathNodeIds[i];

        const sourceMesh = nodeMeshMap.get(prevNodeId);
        const targetMesh = nodeMeshMap.get(currentNodeId);

        if (sourceMesh && targetMesh) {
            createAnimatedLightningBolt(sourceMesh.position, targetMesh.position, 3000, false);
        }
    }
}

function clearActiveLightningBolts() {
    activeLightningBolts.forEach(group => {
        scene.remove(group);
        group.children.forEach(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    });
    activeLightningBolts = [];
}

// Update the highlight function to use persistent lightning bolts
function highlightDiameterPath(sourceNodeId) {
    clearHighlights(); // Clear previous state & cancel animations

    if (!adjacencyList || adjacencyList.size === 0) return;

    const { distances, predecessors } = bfs(sourceNodeId, adjacencyList, graphData.nodes);

    let maxDistance = 0;
    let furthestNodesIds = [];
    
    // Find the maximum distance and furthest nodes
    distances.forEach((dist, nodeId) => {
        if (dist !== Infinity) {
            if (dist > maxDistance) {
                maxDistance = dist;
                furthestNodesIds = [nodeId];
            } else if (dist === maxDistance) {
                furthestNodesIds.push(nodeId);
            }
        }
    });

    if (maxDistance === 0) {
        const sourceMesh = nodeMeshMap.get(sourceNodeId);
        if (sourceMesh) {
            sourceMesh.material = HIGHLIGHT_NODE_MATERIAL;
            highlightedElements.nodes.push(sourceMesh);
        }
        return;
    }

    // Highlight source node
    const sourceMesh = nodeMeshMap.get(sourceNodeId);
    if (sourceMesh) {
        sourceMesh.material = HIGHLIGHT_NODE_MATERIAL;
        highlightedElements.nodes.push(sourceMesh);
    }

    // Create lightning bolts for each path
    furthestNodesIds.forEach(targetNodeId => {
        const pathNodeIds = reconstructPath(sourceNodeId, targetNodeId, predecessors);
        if (pathNodeIds && pathNodeIds.length > 1) {
            // Highlight intermediate path nodes
            for (let i = 1; i < pathNodeIds.length - 1; i++) {
                const nodeMesh = nodeMeshMap.get(pathNodeIds[i]);
                if (nodeMesh) {
                    nodeMesh.material = PATH_NODE_MATERIAL;
                    highlightedElements.nodes.push(nodeMesh);
                }
            }
            
            // Highlight target node
            const targetMesh = nodeMeshMap.get(targetNodeId);
            if (targetMesh) {
                targetMesh.material = HIGHLIGHT_NODE_MATERIAL;
                highlightedElements.nodes.push(targetMesh);
            }
            
            // Create animated lightning bolts between each pair of nodes
            for (let i = 1; i < pathNodeIds.length; i++) {
                const sourceId = pathNodeIds[i-1];
                const targetId = pathNodeIds[i];
                
                const sourceMesh = nodeMeshMap.get(sourceId);
                const targetMesh = nodeMeshMap.get(targetId);
                
                if (sourceMesh && targetMesh) {
                    // Create persistent animated lightning bolts
                    createAnimatedLightningBolt(sourceMesh.position, targetMesh.position, 3000, false);
                }
            }
        }
    });
}

function visualizeGraph(graph, type, use3DLayout = false, params = {}) {
    clearVisualization();
    const nodePositions = new Map();
    const n = graph.nodes.length;
    const nodeIdToData = new Map();
    graph.nodes.forEach(node => nodeIdToData.set(node.id, node));

    // --- 1. Calculate Layout Positions ---
    let rows = 1, cols = n; // Initialize dimensions for mesh/torus/grid fallback
    let camDist = 30; // Default camera distance
    const baseScale = 5; // Base scale factor for layouts

    if (n > 0) {
        // Determine grid dimensions reliably
        if ((type === 'mesh' || type === 'torus') && graph.nodes[0]?.hasOwnProperty('row') && graph.nodes[0]?.hasOwnProperty('col')) {
            rows = Math.max(...graph.nodes.map(n => n.row ?? 0)) + 1;
            cols = Math.max(...graph.nodes.map(n => n.col ?? 0)) + 1;
        } else if (type === 'mesh' || type === 'torus') {
            cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols);
        }

        // --- Apply Layout based on Type and Choice ---
        if (type === 'ring') {
            // --- Ring Layout --- (Unchanged)
            const layoutRadius = n > 1 ? Math.max(5, n * 0.8) : 0;
            graph.nodes.forEach((node, i) => { const angle = (i / n) * Math.PI * 2; const x = layoutRadius * Math.cos(angle); const y = layoutRadius * Math.sin(angle); nodePositions.set(node.id, new THREE.Vector3(x, y, 0)); });
            const camDist = layoutRadius * 2.5; camera.position.set(0, 0, camDist < 30 ? 30 : camDist);

        } else if (type === 'mesh') {
            // --- Mesh Grid Layout --- (Unchanged)
            const gridSpacing = 3 * NODE_RADIUS; const totalWidth = (cols - 1) * gridSpacing; const totalHeight = (rows - 1) * gridSpacing;
            graph.nodes.forEach(node => { const r = node.row ?? Math.floor(node.id / cols); const c = node.col ?? (node.id % cols); const x = (c * gridSpacing) - totalWidth / 2; const y = (-r * gridSpacing) + totalHeight / 2; nodePositions.set(node.id, new THREE.Vector3(x, y, 0)); });
            const camDist = Math.max(totalWidth, totalHeight, 20) * 1.5; camera.position.set(0, 0, camDist < 30 ? 30 : camDist);

        } else if (type === 'torus') {
            // --- Conditional Torus Layout ---
            if (use3DLayout) {
                // --- 3D Geometric Torus Layout --- (Unchanged)
                const nodeSpacingFactor = NODE_RADIUS * 3.5; const minorCircumference = rows * nodeSpacingFactor; const minorRadius = Math.max(NODE_RADIUS * 1.5, minorCircumference / (2 * Math.PI)); const majorCircumference = cols * nodeSpacingFactor; const majorRadius = Math.max(minorRadius * 2.0, majorCircumference / (2 * Math.PI));
                graph.nodes.forEach(node => { const r = node.row ?? 0; const c = node.col ?? 0; const majorAngle = (c / cols) * Math.PI * 2; const minorAngle = (r / rows) * Math.PI * 2; const x = (majorRadius + minorRadius * Math.cos(minorAngle)) * Math.cos(majorAngle); const y = (majorRadius + minorRadius * Math.cos(minorAngle)) * Math.sin(majorAngle); const z = minorRadius * Math.sin(minorAngle); nodePositions.set(node.id, new THREE.Vector3(x, y, z)); });
                const viewDistance = (majorRadius + minorRadius) * 2.2; camera.position.set(0, minorRadius * 0.5, viewDistance < 30 ? 30 : viewDistance);
            } else {
                // --- 2D Grid Layout (for Torus) --- (Unchanged layout logic)
                const gridSpacing = 3 * NODE_RADIUS; const totalWidth = (cols - 1) * gridSpacing; const totalHeight = (rows - 1) * gridSpacing;
                graph.nodes.forEach(node => { const r = node.row ?? Math.floor(node.id / cols); const c = node.col ?? (node.id % cols); const x = (c * gridSpacing) - totalWidth / 2; const y = (-r * gridSpacing) + totalHeight / 2; nodePositions.set(node.id, new THREE.Vector3(x, y, 0)); });
                const camDist = Math.max(totalWidth, totalHeight, 20) * 1.5; camera.position.set(0, 0, camDist < 30 ? 30 : camDist);
            }
        } else if (type === 'hypercube') { // **** ADD HYPERCUBE LAYOUT ****
            const d = params.dimension || 0; // Get dimension from params
            let scale = baseScale; // Adjust scale based on dimension

            if (d === 0) { // Single node
                nodePositions.set(0, new THREE.Vector3(0, 0, 0));
                scale = 1;
            } else if (d === 1) { // Line
                scale = baseScale * 0.5;
                nodePositions.set(0, new THREE.Vector3(-scale, 0, 0)); // Binary '0'
                nodePositions.set(1, new THREE.Vector3(scale, 0, 0)); // Binary '1'
            } else if (d === 2) { // Square
                scale = baseScale * 0.8;
                graph.nodes.forEach(node => {
                    const bits = node.binary; // e.g., "01"
                    const x = (bits[0] === '0' ? -scale : scale); // Bit 0 -> X
                    const y = (bits[1] === '0' ? -scale : scale); // Bit 1 -> Y
                    nodePositions.set(node.id, new THREE.Vector3(x, y, 0));
                });
            } else if (d === 3) { // Cube
                scale = baseScale * 1.0;
                graph.nodes.forEach(node => {
                    const bits = node.binary; // e.g., "011"
                    const x = (bits[0] === '0' ? -scale : scale); // Bit 0 -> X
                    const y = (bits[1] === '0' ? -scale : scale); // Bit 1 -> Y
                    const z = (bits[2] === '0' ? -scale : scale); // Bit 2 -> Z
                    nodePositions.set(node.id, new THREE.Vector3(x, y, z));
                });
            } else if (d === 4) { // Tesseract (two cubes)
                scale = baseScale * 1.2;
                const scaleInner = 0.6; // Scale factor for the 'inner' cube
                graph.nodes.forEach(node => {
                    const bits = node.binary; // e.g., "1010"
                    const wBit = bits[0]; // Use first bit for W (inner/outer)
                    const xBit = bits[1]; // Bit 1 -> X
                    const yBit = bits[2]; // Bit 2 -> Y
                    const zBit = bits[3]; // Bit 3 -> Z

                    let currentScale = (wBit === '0' ? scale * scaleInner : scale);
                    const x = (xBit === '0' ? -currentScale : currentScale);
                    const y = (yBit === '0' ? -currentScale : currentScale);
                    const z = (zBit === '0' ? -currentScale : currentScale);
                    nodePositions.set(node.id, new THREE.Vector3(x, y, z));
                });
            } else { // Fallback for d > 4: Circular Layout
                console.warn(`Hypercube dimension ${d} > 4. Using fallback circular layout.`);
                const layoutRadius = n > 1 ? Math.max(5, n * 0.5) : 0; // Adjust radius calc
                graph.nodes.forEach((node, i) => {
                    const angle = (i / n) * Math.PI * 2;
                    const x = layoutRadius * Math.cos(angle);
                    const y = layoutRadius * Math.sin(angle);
                    nodePositions.set(node.id, new THREE.Vector3(x, y, 0));
                });
                scale = layoutRadius; // Base camera distance on radius
            }
            // Adjust camera distance for hypercube based on overall scale
            camDist = scale * 3.5;

        }  // Add layout logic for other topologies here
    } // End if (n > 0) for layout

    // --- Reset Helper Maps ---
    nodeMeshMap.clear();
    edgeMeshMap.clear();

    // --- 2. Create Node Meshes ---
    graph.nodes.forEach(node => {
        try { // Add try-catch for detailed error within loop
            const geometry = new THREE.SphereGeometry(NODE_RADIUS, NODE_SEGMENTS, NODE_SEGMENTS);
            const mesh = new THREE.Mesh(geometry, NODE_MATERIAL);
            const nodePos = nodePositions.get(node.id);
            if (nodePos) {
                mesh.position.copy(nodePos);
            } else {
                console.warn(`Position not found for node ${node.id} during mesh creation.`);
                mesh.position.set(0, 0, 0);
            }

            mesh.userData = { nodeId: node.id };
            nodeMeshMap.set(node.id, mesh);

            scene.add(mesh);
            nodeMeshes.push(mesh);
        } catch (error) {
            console.error(`Error creating node ${node.id}:`, error); // DEBUG
        }
    });

    // Adjust camera Z position, ensuring minimum distance
    camera.position.z = Math.max(30, camDist); // Use calculated camDist

    // --- 3. Create Edge Meshes (Conditional Lines / Curves) ---
    graph.edges.forEach(edge => {
        const pos1 = nodePositions.get(edge.source);
        const pos2 = nodePositions.get(edge.target);
        const node1 = nodeIdToData.get(edge.source);
        const node2 = nodeIdToData.get(edge.target);

        if (pos1 && pos2 && node1 && node2) {
            let isWrapEdge = false;
            let isHorizontalWrap = false;
            let isVerticalWrap = false;
            let geometry;
            let lineMaterial = EDGE_MATERIAL;

            // Determine wrap type
            if (type === 'torus' && node1.hasOwnProperty('row') && node1.hasOwnProperty('col')) {
                if (cols > 1 && Math.abs(node1.col - node2.col) === cols - 1) {
                    isWrapEdge = true; isHorizontalWrap = true;
                }
                if (rows > 1 && Math.abs(node1.row - node2.row) === rows - 1) {
                    isWrapEdge = true; isVerticalWrap = true;
                    if (isHorizontalWrap) isHorizontalWrap = false; // Prioritize vertical if both? Adjust as needed.
                }
            }

            if (isWrapEdge && type === 'torus' && !use3DLayout) {
                lineMaterial = WRAP_EDGE_MATERIAL;
                const points = [];
                // --- Define Shape Parameters ---
                // Adjust cornerRadius to control the roundness and offset distance
                // Maybe base it on NODE_RADIUS or grid spacing?
                const cornerRadius = NODE_RADIUS * 2; // Example: Try adjusting this value
                const numPointsPerArc = 10; // Segments per 90-degree corner

                // Ensure pos1 and pos2 are ordered consistently for calculations
                // (e.g., pos1 is always the 'left' or 'top' node of the pair)
                let pStart = pos1.clone();
                let pEnd = pos2.clone();

                if (isHorizontalWrap && pos1.x > pos2.x) { [pStart, pEnd] = [pEnd, pStart]; }
                if (isVerticalWrap && pos1.y < pos2.y) { [pStart, pEnd] = [pEnd, pStart]; } // Assuming Y decreases downwards


                // --- Generate Points ---
                if (isHorizontalWrap) {
                    // Rounded Rect Arc - Horizontal (Above/Below)
                    // arcGoesPositive = true means arc goes above (positive Y offset)
                    const arcGoesPositive = true; // Or alternate: (node1.row % 2 === 0);
                    const yDirection = arcGoesPositive ? 1 : -1;

                    // Calculate key points for the path
                    const P1 = new THREE.Vector3(pStart.x + cornerRadius, pStart.y + cornerRadius * yDirection, pStart.z);
                    const P2 = new THREE.Vector3(pEnd.x - cornerRadius, pEnd.y + cornerRadius * yDirection, pEnd.z);

                    // Arc 1 Center and Angles (near pStart)
                    const center1 = new THREE.Vector3(pStart.x + cornerRadius, pStart.y, pStart.z);
                    const startAngle1 = Math.PI; // 180 deg
                    const endAngle1 = Math.PI / 2; // 90 deg

                    // Arc 2 Center and Angles (near pEnd)
                    const center2 = new THREE.Vector3(pEnd.x - cornerRadius, pEnd.y, pEnd.z);
                    const startAngle2 = Math.PI / 2; // 90 deg
                    const endAngle2 = 0;         // 0 deg

                    // Generate points for Arc 1
                    for (let i = 0; i <= numPointsPerArc; i++) {
                        const angle = startAngle1 + (endAngle1 - startAngle1) * (i / numPointsPerArc);
                        points.push(new THREE.Vector3(
                            center1.x + cornerRadius * Math.cos(angle),
                            center1.y + cornerRadius * Math.sin(angle) * yDirection, // Apply direction
                            center1.z
                        ));
                    }

                    // Add the straight segment end point (P2)
                    // The line geometry connects the last point of arc1 to P2 implicitly
                    // unless P1 and P2 are the same, which they shouldn't be here.
                    // We actually need the points *between* P1 and P2 for the line.
                    // Let's recalculate the point generation slightly.

                    points.length = 0; // Reset points array

                    // Generate Arc 1 points (pStart up to P1)
                    for (let i = 0; i <= numPointsPerArc; i++) {
                        let angle = Math.PI - (Math.PI / 2) * (i / numPointsPerArc); // Angle from PI down to PI/2
                        points.push(new THREE.Vector3(
                            pStart.x + cornerRadius * (1 + Math.cos(angle)), // Center is (pStart.x + R, pStart.y)
                            pStart.y + cornerRadius * Math.sin(angle) * yDirection,
                            pStart.z
                        ));
                    }

                    // Generate Straight Line points (P1 to P2) - optional if P1,P2 is enough
                    // points.push(P1); // Ensure P1 is included if arc didn't land exactly
                    points.push(P2); // Add P2 - Line connects last arc1 point to P2

                    // Generate Arc 2 points (P2 down to pEnd)
                    for (let i = 0; i <= numPointsPerArc; i++) {
                        let angle = Math.PI / 2 - (Math.PI / 2) * (i / numPointsPerArc); // Angle from PI/2 down to 0
                        points.push(new THREE.Vector3(
                            pEnd.x - cornerRadius * (1 - Math.cos(angle)), // Center is (pEnd.x - R, pEnd.y)
                            pEnd.y + cornerRadius * Math.sin(angle) * yDirection,
                            pEnd.z
                        ));
                    }


                } else if (isVerticalWrap) {
                    // Rounded Rect Arc - Vertical (Left/Right)
                    // arcGoesPositive = true means arc goes right (positive X offset)
                    const arcGoesPositive = true; // Or alternate: (node1.col % 2 !== 0);
                    const xDirection = arcGoesPositive ? 1 : -1;

                    // Calculate key points
                    const P1 = new THREE.Vector3(pStart.x + cornerRadius * xDirection, pStart.y - cornerRadius, pStart.z);
                    const P2 = new THREE.Vector3(pEnd.x + cornerRadius * xDirection, pEnd.y + cornerRadius, pEnd.z);


                    points.length = 0; // Reset points array

                    // Generate Arc 1 points (pStart right/left to P1) - pStart is top node
                    for (let i = 0; i <= numPointsPerArc; i++) {
                        let angle = Math.PI / 2 - (Math.PI / 2) * (i / numPointsPerArc); // Angle from PI/2 down to 0
                        points.push(new THREE.Vector3(
                            pStart.x + cornerRadius * Math.cos(angle) * xDirection,
                            pStart.y - cornerRadius * (1 - Math.sin(angle)), // Center is (pStart.x, pStart.y - R)
                            pStart.z
                        ));
                    }

                    // Generate Straight Line points (P1 to P2)
                    points.push(P2); // Add P2

                    // Generate Arc 2 points (P2 right/left to pEnd) - pEnd is bottom node
                    for (let i = 0; i <= numPointsPerArc; i++) {
                        let angle = 0 - (Math.PI / 2) * (i / numPointsPerArc); // Angle from 0 down to -PI/2
                        points.push(new THREE.Vector3(
                            pEnd.x + cornerRadius * Math.cos(angle) * xDirection,
                            pEnd.y + cornerRadius * (1 + Math.sin(angle)), // Center is (pEnd.x, pEnd.y + R)
                            pEnd.z
                        ));
                    }
                }

                // Create geometry from the generated points
                if (points.length > 1) {
                    geometry = new THREE.BufferGeometry().setFromPoints(points);
                } else {
                    // Fallback to straight line if arc generation failed
                    console.warn("Failed to generate sufficient points for rounded rect arc. Drawing straight line.");
                    geometry = new THREE.BufferGeometry().setFromPoints([pos1, pos2]);
                }

            } else {
                // **** Draw Straight Line **** (Non-wrap, Mesh, Ring, 3D Torus)
                geometry = new THREE.BufferGeometry().setFromPoints([pos1, pos2]);
                if (isWrapEdge && type === 'torus' && use3DLayout) {
                    lineMaterial = WRAP_EDGE_MATERIAL;
                }
            }

            // Create the line object
            if (geometry) {
                // Ensure we use a unique material instance per line if changing color directly
                const currentLineMaterial = lineMaterial.clone(); // Clone to avoid changing shared materials

                const line = new THREE.Line(geometry, currentLineMaterial);

                line.userData = { source: edge.source, target: edge.target };
                const edgeKey = `${Math.min(edge.source, edge.target)}-${Math.max(edge.source, edge.target)}`;
                edgeMeshMap.set(edgeKey, line); // Store line reference

                scene.add(line);
                edgeMeshes.push(line);
            } else {
                console.warn(`Failed to create geometry for edge: ${edge.source} -> ${edge.target}`);
            }

        } else {
            console.warn(`Could not find position or node data for edge: ${edge.source} -> ${edge.target}`);
        }
    }); // End of graph.edges.forEach

    // --- Final Adjustments ---
    controls.target.set(0, 0, 0); // Reset target
    if (type === 'torus' && use3DLayout) {
        camera.lookAt(0, 0, 0); // Point camera towards the center for 3D view
    } else if (type === 'hypercube' && params.dimension && params.dimension > 1) {
        camera.lookAt(0, 0, 0); // Look at center for hypercubes too
    }
    controls.update();
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // Only needed if enableDamping or autoRotate are set
    
    // Use EffectComposer for rendering with bloom effect
    composer.render();
}

// --- Window Resize Handler ---
function onWindowResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    
    // Also update composer size when window resizes
    composer.setSize(container.clientWidth, container.clientHeight);
}

// --- Start Application ---
init();