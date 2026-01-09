import React, { useMemo, useState, useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment, Text } from '@react-three/drei';
import * as THREE from 'three';
import { NodeData, NetworkLayout } from '../types';

// Constants for layout
const SPINE_COUNT = 64;
const LEAF_GROUPS = 16;
const LEAFS_PER_GROUP = 8;
const SPINE_Y = 15;
const LEAF_Y = -5;
const SERVER_Y = -25;
const SPINE_SPACING = 2.5;
const GROUP_SPACING = 10;
const LEAF_LOCAL_SPACING_Z = 2.0; 
const CLUSTER_SPACING_Z = 60; 

// Server Constants
const SERVERS_PER_GROUP_STD = 64;
const SERVERS_LAST_GROUP = 56;
const SERVER_SPACING = 1.0; 

// --- Sub-components defined internally for performance & scope access ---

/**
 * Renders all switches/servers using InstancedMesh for performance
 */
const NodeInstances = ({ 
  data, 
  color, 
  hoveredNode, 
  onHover,
  geometryType = 'box' 
}: { 
  data: NodeData[], 
  color: string, 
  hoveredNode: NodeData | null,
  onHover: (node: NodeData | null) => void,
  geometryType?: 'box' | 'smallBox'
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObject = new THREE.Object3D();
  const hoverColor = new THREE.Color('#ffffff'); // White hot for hover
  const baseColor = new THREE.Color(color);

  // Update instance matrices only on mount
  React.useLayoutEffect(() => {
    if (!meshRef.current) return;
    
    // Safety: If no data, skip matrix updates
    if (data.length === 0) return;

    data.forEach((node, i) => {
      tempObject.position.copy(node.position);
      tempObject.updateMatrix();
      meshRef.current!.setMatrixAt(i, tempObject.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    
    if (meshRef.current.geometry) {
      meshRef.current.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    }
  }, [data]);

  // Update colors based on hover state
  useFrame(() => {
    if (!meshRef.current) return;
    
    // Safety: If no data, skip color updates to avoid accessing null instanceColor
    if (data.length === 0) return;
    
    data.forEach((node, i) => {
      const isHovered = hoveredNode?.id === node.id && hoveredNode?.type === node.type;
      
      let highlight = false;
      
      if (hoveredNode) {
        // Logic for highlighting connections
        if (hoveredNode.type === 'spine' && node.type === 'leaf' && hoveredNode.clusterId === node.clusterId) highlight = true;
        if (hoveredNode.type === 'leaf' && node.type === 'spine' && hoveredNode.clusterId === node.clusterId) highlight = true;
        
        if (hoveredNode.type === 'server' && node.type === 'leaf' && hoveredNode.groupId === node.groupId) highlight = true;
        if (hoveredNode.type === 'leaf' && node.type === 'server' && hoveredNode.groupId === node.groupId) highlight = true;
      }

      if (isHovered) {
        meshRef.current!.setColorAt(i, hoverColor);
      } else if (highlight) {
        // Highlight related nodes slightly brighter
        const relatedColor = baseColor.clone().lerp(new THREE.Color('#ffffff'), 0.5);
        meshRef.current!.setColorAt(i, relatedColor);
      } else {
        // Dim non-active nodes slightly to make active ones pop
        const dimmedColor = hoveredNode ? baseColor.clone().multiplyScalar(0.3) : baseColor;
        meshRef.current!.setColorAt(i, dimmedColor);
      }
    });
    
    // Only update if instanceColor has been initialized
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, data.length]}
      frustumCulled={false}
      onPointerOver={(e) => {
        e.stopPropagation();
        const instanceId = e.instanceId;
        if (instanceId !== undefined) onHover(data[instanceId]);
      }}
      onPointerOut={() => onHover(null)}
    >
      {geometryType === 'box' ? (
        <boxGeometry args={[1.5, 0.5, 1.2]} /> 
      ) : (
        <boxGeometry args={[0.8, 0.2, 0.8]} /> 
      )}
      {/* Tech Material: High metalness, slight roughness for cyber look */}
      <meshStandardMaterial 
        roughness={0.2} 
        metalness={0.9} 
        emissive={color}
        emissiveIntensity={0.5}
      />
    </instancedMesh>
  );
};

/**
 * Renders the connections.
 */
const Connections = ({ layout, hoveredNode }: { layout: NetworkLayout, hoveredNode: NodeData | null }) => {
  
  // 1. Static Full Mesh Geometry
  const staticGeo = useMemo(() => {
    const points: number[] = [];
    
    // Spine <-> Leaf
    layout.spines.forEach(spine => {
      layout.leafs.forEach(leaf => {
        if (spine.clusterId === leaf.clusterId) {
          points.push(spine.position.x, spine.position.y, spine.position.z);
          points.push(leaf.position.x, leaf.position.y, leaf.position.z);
        }
      });
    });

    // Server <-> Leaf
    if (layout.servers.length > 0) {
      layout.servers.forEach(server => {
        layout.leafs.forEach(leaf => {
           if (leaf.groupId === server.groupId) {
             points.push(server.position.x, server.position.y, server.position.z);
             points.push(leaf.position.x, leaf.position.y, leaf.position.z);
           }
        });
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geometry;
  }, [layout]);

  // 2. Active Highlight Geometry
  const activeGeo = useMemo(() => {
    if (!hoveredNode) return null;
    
    const points: number[] = [];
    const addLine = (n1: NodeData, n2: NodeData) => {
      points.push(n1.position.x, n1.position.y, n1.position.z);
      points.push(n2.position.x, n2.position.y, n2.position.z);
    };

    if (hoveredNode.type === 'spine') {
      layout.leafs.forEach(leaf => {
        if (leaf.clusterId === hoveredNode.clusterId) addLine(hoveredNode, leaf);
      });
    } else if (hoveredNode.type === 'leaf') {
      layout.spines.forEach(spine => {
        if (spine.clusterId === hoveredNode.clusterId) addLine(hoveredNode, spine);
      });
      layout.servers.forEach(server => {
        if (server.groupId === hoveredNode.groupId) addLine(hoveredNode, server);
      });
    } else if (hoveredNode.type === 'server') {
      layout.leafs.forEach(leaf => {
        if (leaf.groupId === hoveredNode.groupId) addLine(hoveredNode, leaf);
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geometry;
  }, [hoveredNode, layout]);

  return (
    <group>
      {/* Background Full Mesh - NVIDIA Green */}
      <lineSegments geometry={staticGeo} frustumCulled={false}>
        <lineBasicMaterial color="#76b900" opacity={0.15} transparent depthWrite={false} />
      </lineSegments>

      {/* Active Highlights - Pure White and Opaque */}
      {activeGeo && (
        <lineSegments geometry={activeGeo} frustumCulled={false}>
          <lineBasicMaterial color="#ffffff" opacity={1.0} transparent linewidth={2} />
        </lineSegments>
      )}
    </group>
  );
};

/**
 * Escape Connections
 */
const EscapeConnections = ({ 
  layout, 
  active, 
  clusterCount 
}: { 
  layout: NetworkLayout; 
  active: boolean; 
  clusterCount: number; 
}) => {
  const geometry = useMemo(() => {
    if (!active || clusterCount < 2) return null;
    
    const points: number[] = [];
    const LEAFS_PER_CLUSTER = LEAF_GROUPS * LEAFS_PER_GROUP;
    const LAST_GROUP_OFFSET = (LEAF_GROUPS - 1) * LEAFS_PER_GROUP;

    for (let c = 0; c < clusterCount - 1; c++) {
       const startIdxA = (c * LEAFS_PER_CLUSTER) + LAST_GROUP_OFFSET;
       const startIdxB = ((c + 1) * LEAFS_PER_CLUSTER) + LAST_GROUP_OFFSET;

       for (let i = 0; i < LEAFS_PER_GROUP; i++) {
         const leafA = layout.leafs[startIdxA + i];
         const leafB = layout.leafs[startIdxB + i];
         
         if (leafA && leafB) {
            const start = leafA.position;
            const end = leafB.position;
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            const midZ = (start.z + end.z) / 2;
            const curveDepth = 25; 
            const controlPoint = new THREE.Vector3(midX, midY - curveDepth, midZ);
            const curve = new THREE.QuadraticBezierCurve3(start, controlPoint, end);
            const curvePoints = curve.getPoints(20);
            
            for (let k = 0; k < curvePoints.length - 1; k++) {
              points.push(curvePoints[k].x, curvePoints[k].y, curvePoints[k].z);
              points.push(curvePoints[k + 1].x, curvePoints[k + 1].y, curvePoints[k + 1].z);
            }
         }
       }
    }

    if (points.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
  }, [layout, active, clusterCount]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      {/* Warning Red - Keep red for critical path/escape to contrast with green */}
      <lineBasicMaterial color="#ff3333" linewidth={2} opacity={1} transparent />
    </lineSegments>
  );
};

const Labels = ({ hoveredNode }: { hoveredNode: NodeData | null }) => {
  if (!hoveredNode) return null;
  return (
    <Text
      position={[hoveredNode.position.x, hoveredNode.position.y + 2.5, hoveredNode.position.z]}
      fontSize={1.5}
      color="#ffffff"
      anchorX="center"
      anchorY="bottom"
      outlineWidth={0.05}
      outlineColor="#000000"
    >
      {hoveredNode.label}
    </Text>
  );
};

// --- Main Scene Component ---

export const NetworkScene: React.FC = () => {
  const [hoveredNode, setHoveredNode] = useState<NodeData | null>(null);
  const [clusterCount, setClusterCount] = useState(1);
  const [isEscapeMode, setIsEscapeMode] = useState(false);
  const [isServerMode, setIsServerMode] = useState(false);
  const [isAutoAnimating, setIsAutoAnimating] = useState(false);

  // Generate Layout Data Once
  const layout = useMemo<NetworkLayout>(() => {
    const spines: NodeData[] = [];
    const leafs: NodeData[] = [];
    const servers: NodeData[] = [];

    let globalIdCounter = 0;

    // 1. Generate Clusters (Spines & Leafs)
    for (let c = 0; c < clusterCount; c++) {
      const clusterZOffset = c * CLUSTER_SPACING_Z * -1; 
      
      const totalSpineWidth = (SPINE_COUNT - 1) * SPINE_SPACING;
      const spineStartX = -totalSpineWidth / 2;

      // Spines
      for (let i = 0; i < SPINE_COUNT; i++) {
        spines.push({
          id: globalIdCounter++,
          clusterId: c,
          type: 'spine',
          position: new THREE.Vector3(spineStartX + i * SPINE_SPACING, SPINE_Y, clusterZOffset),
          label: `C${c + 1}-Spine-${i + 1}`
        });
      }

      // Leafs
      const totalGroupWidth = (LEAF_GROUPS - 1) * GROUP_SPACING;
      const groupStartX = -totalGroupWidth / 2;

      for (let g = 0; g < LEAF_GROUPS; g++) {
        const groupCenterX = groupStartX + g * GROUP_SPACING;
        
        for (let l = 0; l < LEAFS_PER_GROUP; l++) {
          const zOffset = (l - (LEAFS_PER_GROUP - 1) / 2) * LEAF_LOCAL_SPACING_Z;

          leafs.push({
            id: globalIdCounter++,
            clusterId: c,
            type: 'leaf',
            groupId: g,
            position: new THREE.Vector3(groupCenterX, LEAF_Y, zOffset + clusterZOffset),
            label: `C${c + 1}-Leaf-G${g + 1}-${l + 1}`
          });
        }
      }
    }

    // 2. Generate Servers (If Mode Active)
    if (isServerMode) {
       const totalGroupWidth = (LEAF_GROUPS - 1) * GROUP_SPACING;
       const groupStartX = -totalGroupWidth / 2;
       
       const baseZ = clusterCount > 1 ? (0 + (CLUSTER_SPACING_Z * -1)) / 2 : 0;

       for (let g = 0; g < LEAF_GROUPS; g++) {
         const groupCenterX = groupStartX + g * GROUP_SPACING;
         const serverCount = (g === 15) ? SERVERS_LAST_GROUP : SERVERS_PER_GROUP_STD;

         const totalLength = (serverCount - 1) * SERVER_SPACING;

         for (let s = 0; s < serverCount; s++) {
           const zOffset = (s * SERVER_SPACING) - (totalLength / 2);

           servers.push({
             id: globalIdCounter++,
             type: 'server',
             groupId: g,
             position: new THREE.Vector3(groupCenterX, SERVER_Y, baseZ + zOffset),
             label: `Server-G${g + 1}-${s + 1}`
           });
         }
       }
    }

    return { spines, leafs, servers };
  }, [clusterCount, isServerMode]);

  const runAutoSequence = () => {
    if (isAutoAnimating) return;
    setIsAutoAnimating(true);

    setClusterCount(prev => prev + 1);

    setTimeout(() => {
      setIsEscapeMode(prev => !prev);
    }, 2000);

    setTimeout(() => {
      setIsServerMode(prev => !prev);
      setIsAutoAnimating(false);
    }, 4000);
  };

  return (
    <div className="w-full h-full relative bg-black overflow-hidden">
       {/* Removed gradient overlay for pure black */}
       
       <div className="absolute top-6 left-6 z-10 pointer-events-none select-none">
        <h1 className="text-3xl font-bold text-white tracking-tighter drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
          DATA CENTER <span className="text-[#76b900]">VISUALIZER</span>
        </h1>
        <div className="w-full h-px bg-gradient-to-r from-[#76b900] to-transparent my-2" />
        <p className="text-sm text-gray-400 mt-1 font-mono">
          <span className="text-[#76b900] font-bold">64</span> Spines [Tier-1] <br/>
          <span className="text-[#4ade80] font-bold">128</span> Leafs [Tier-2] <br/>
          {isServerMode && <><span className="text-[#ccff00] font-bold">1016</span> Servers [Tier-3] <br/></>}
          <span className="text-gray-500 text-xs">Clusters Active: {clusterCount}</span>
        </p>
      </div>

      {/* Controls */}
      <div className="absolute bottom-6 left-6 z-20 flex gap-4">
        
        {/* Auto Button */}
        <button 
          onClick={runAutoSequence}
          disabled={isAutoAnimating}
          className={`${isAutoAnimating ? 'bg-lime-900/50 border-lime-500 text-lime-200 cursor-not-allowed' : 'bg-gray-900/80 border-lime-600/50 hover:bg-lime-900/30 hover:border-lime-500 text-lime-400 hover:text-lime-200'} backdrop-blur-md border font-mono font-bold py-2 px-6 rounded-sm shadow-[0_0_15px_rgba(118,185,0,0.2)] transition-all active:scale-95 flex items-center gap-2`}
        >
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
           {isAutoAnimating ? 'EXECUTING...' : 'AUTO_SEQ'}
        </button>

        <button 
          onClick={() => setClusterCount(c => c + 1)}
          disabled={isAutoAnimating}
          className={`${isAutoAnimating ? 'opacity-50 cursor-not-allowed' : ''} bg-gray-900/80 backdrop-blur-md border border-[#76b900]/50 hover:bg-green-900/30 hover:border-[#76b900] text-[#76b900] hover:text-green-200 font-mono font-bold py-2 px-6 rounded-sm shadow-[0_0_15px_rgba(118,185,0,0.2)] transition-all active:scale-95 flex items-center gap-2`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          ADD_CLUSTER
        </button>

        <button 
          onClick={() => setIsEscapeMode(prev => !prev)}
          disabled={isAutoAnimating}
          className={`${isEscapeMode ? 'bg-red-900/60 border-red-500 text-red-100 shadow-[0_0_20px_rgba(220,38,38,0.4)]' : 'bg-gray-900/80 border-red-900/50 text-red-500 hover:border-red-500 hover:bg-red-900/30'} ${isAutoAnimating ? 'opacity-50 cursor-not-allowed' : ''} backdrop-blur-md border font-mono font-bold py-2 px-6 rounded-sm transition-all active:scale-95 flex items-center gap-2`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          ESCAPE: {isEscapeMode ? 'ACTIVE' : 'OFF'}
        </button>

        <button 
          onClick={() => setIsServerMode(prev => !prev)}
          disabled={isAutoAnimating}
          className={`${isServerMode ? 'bg-[#ccff00]/20 border-[#ccff00] text-[#ccff00] shadow-[0_0_20px_rgba(204,255,0,0.2)]' : 'bg-gray-900/80 border-[#ccff00]/50 text-[#ccff00] hover:border-[#ccff00] hover:bg-[#ccff00]/10'} ${isAutoAnimating ? 'opacity-50 cursor-not-allowed' : ''} backdrop-blur-md border font-mono font-bold py-2 px-6 rounded-sm transition-all active:scale-95 flex items-center gap-2`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h9.45a3.375 3.375 0 012.7 1.35L20.1 9.75" />
          </svg>
          SERVERS: {isServerMode ? 'VISIBLE' : 'HIDDEN'}
        </button>
      </div>

      {hoveredNode && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 pointer-events-none bg-black/80 border border-[#76b900]/50 p-4 rounded-sm shadow-[0_0_30px_rgba(118,185,0,0.1)] backdrop-blur-md text-center min-w-[200px]">
          <div className="text-lg font-bold text-[#76b900] mb-1 font-mono">{hoveredNode.label}</div>
          <div className="h-px w-full bg-gray-700 my-2"></div>
          <div className="text-xs text-gray-400 uppercase tracking-widest font-mono">TYPE: <span className="text-white">{hoveredNode.type}</span></div>
          {hoveredNode.clusterId !== undefined && (
             <div className="text-xs text-[#76b900] mt-2 font-semibold font-mono">CLUSTER_ID: {hoveredNode.clusterId + 1}</div>
          )}
          {hoveredNode.groupId !== undefined && (
             <div className="text-xs text-[#4ade80] mt-1 font-semibold font-mono">GROUP_ID: {hoveredNode.groupId + 1}</div>
          )}
        </div>
      )}

      <Canvas>
        <PerspectiveCamera makeDefault position={[0, 60, 160]} fov={45} near={0.1} far={5000} />
        <OrbitControls 
          target={[0, 0, -30 * (clusterCount - 1)]} 
          maxPolarAngle={Math.PI / 1.9} 
          minDistance={10}
          maxDistance={1000}
        />
        
        {/* Pure Black Background */}
        <color attach="background" args={['#000000']} />
        
        {/* Lighting - Green & Cold White for that tech feel */}
        <ambientLight intensity={0.3} />
        <pointLight position={[100, 100, 100]} intensity={2.5} color="#76b900" />
        <pointLight position={[-100, 50, -100]} intensity={1.5} color="#ffffff" />
        <directionalLight position={[0, 100, 20]} intensity={2} color="#ccff00" />
        
        <Suspense fallback={null}>
          <group>
            {/* Spines - NVIDIA Green */}
            <NodeInstances 
              data={layout.spines} 
              color="#76b900" 
              hoveredNode={hoveredNode} 
              onHover={setHoveredNode} 
            />

            {/* Leafs - Deep Green/Emerald */}
            <NodeInstances 
              data={layout.leafs} 
              color="#006039" 
              hoveredNode={hoveredNode} 
              onHover={setHoveredNode} 
            />

            {/* Servers - High-vis Volt/Lime */}
            <NodeInstances 
              data={layout.servers} 
              color="#ccff00" 
              hoveredNode={hoveredNode} 
              onHover={setHoveredNode}
              geometryType="smallBox"
            />

            <Connections layout={layout} hoveredNode={hoveredNode} />
            <EscapeConnections layout={layout} active={isEscapeMode} clusterCount={clusterCount} />
            <Labels hoveredNode={hoveredNode} />
          </group>
        </Suspense>

        {/* Grid - Dark and subtle */}
        <gridHelper args={[600, 60, '#333333', '#111111']} position={[0, SERVER_Y - 5, -50]} />
      </Canvas>
    </div>
  );
};