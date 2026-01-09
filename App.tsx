import React from 'react';
import { NetworkScene } from './components/NetworkScene';

function App() {
  return (
    <div className="w-full h-screen flex flex-col bg-black">
      {/* 3D Viewport */}
      <div className="flex-grow relative">
        <NetworkScene />
      </div>
    </div>
  );
}

export default App;