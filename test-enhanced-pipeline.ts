#!/usr/bin/env bun

// Test script for enhanced pipeline rendering
// Demonstrates frontier-grade pipeline output formatting

import { EnhancedPhaseRenderer } from './src/cli/enhanced-phase-renderer.js';

// Create an enhanced renderer
const renderer = EnhancedPhaseRenderer.create();
renderer.begin();

// Simulate a pipeline execution
renderer.setRequest('make react todoapp');

// Simulate phase 1: Repository Analysis
setTimeout(() => {
  renderer.onEvent({
    type: 'phase_start',
    phaseId: 'repository-analysis',
  });
  
  // Simulate scanning
  setTimeout(() => {
    renderer.onEvent({
      type: 'phase_line',
      phaseId: 'repository-analysis',
      line: 'Scanning: C:/Users/igorr/coding/sophos/test',
      metadata: { type: 'system', icon: '⚙️' }
    });
  }, 500);
  
  // Simulate LLM call
  setTimeout(() => {
    renderer.onEvent({
      type: 'phase_line',
      phaseId: 'repository-analysis',
      line: 'Calling LLM for repository analysis...',
      metadata: { type: 'info', icon: '🧠' }
    });
  }, 1000);
  
  // Simulate analysis complete
  setTimeout(() => {
    renderer.onEvent({
      type: 'phase_line',
      phaseId: 'repository-analysis',
      line: 'LLM analysis complete (492 tokens)',
      metadata: { type: 'success', icon: '✓' }
    });
    
    // Simulate structured results
    setTimeout(() => {
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'repository-analysis',
        line: 'Type: web-app',
        metadata: { type: 'kv', indent: 1 }
      });
      
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'repository-analysis',
        line: 'Stack: JavaScript, HTML, CSS',
        metadata: { type: 'kv', indent: 1 }
      });
      
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'repository-analysis',
        line: 'Files: 0',
        metadata: { type: 'kv', indent: 1 }
      });
      
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'repository-analysis',
        line: 'Risks: 3 detected',
        metadata: { type: 'kv', indent: 1 }
      });
      
      // Simulate phase completion
      setTimeout(() => {
        renderer.onEvent({
          type: 'phase_done',
          phaseId: 'repository-analysis',
          durationMs: 208000, // 3m 28s
        });
      }, 500);
    }, 500);
  }, 2000);
}, 1000);

// Simulate phase 2: Planning Swarm
setTimeout(() => {
  renderer.onEvent({
    type: 'phase_start',
    phaseId: 'planning-swarm',
  });
  
  // Simulate spawning agents
  setTimeout(() => {
    renderer.onEvent({
      type: 'phase_line',
      phaseId: 'planning-swarm',
      line: 'Spawning 8 planning agents…',
      metadata: { type: 'info', icon: '⚡' }
    });
    
    // Simulate GPU info
    setTimeout(() => {
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'planning-swarm',
        line: 'GPU: NVIDIA GeForce RTX 4070 Ti (9.3/12GB free)',
        metadata: { type: 'hardware', icon: '🖥️' }
      });
      
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'planning-swarm',
        line: 'NVIDIA GeForce RTX 4070 Ti: 12GB total, 9GB free',
        metadata: { type: 'hardware', indent: 1 }
      });
      
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'planning-swarm',
        line: '24GB model + 41MB ctx = 24GB/instance',
        metadata: { type: 'hardware', indent: 1 }
      });
      
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'planning-swarm',
        line: '8GB available → 0 fit (VRAM), 14 (CPU)',
        metadata: { type: 'hardware', indent: 1 }
      });
      
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'planning-swarm',
        line: '⚠ Model too large for VRAM — offloading to RAM (64GB system, 61GB free)',
        metadata: { type: 'warning', icon: '⚠️' }
      });
      
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'planning-swarm',
        line: '2 instances fit in RAM, 14 by CPU → using 2',
        metadata: { type: 'info', indent: 1 }
      });
      
      renderer.onEvent({
        type: 'phase_line',
        phaseId: 'planning-swarm',
        line: '💡 Set ollama.concurrent_requests to override, or reduce num_ctx / use a smaller model',
        metadata: { type: 'info', icon: '💡' }
      });
      
      // Simulate batch execution
      setTimeout(() => {
        renderer.onEvent({
          type: 'phase_line',
          phaseId: 'planning-swarm',
          line: 'Batch 1/4: Running Architecture, Backend...',
          metadata: { type: 'batch', icon: '⚡' }
        });
        
        // Simulate LLM token streaming
        const tokens = ['Planning', ' architecture', ' for', ' React', ' todo', ' app', '...'];
        let tokenIndex = 0;
        
        const tokenInterval = setInterval(() => {
          if (tokenIndex < tokens.length) {
            renderer.onEvent({
              type: 'llm_token',
              phaseId: 'planning-swarm',
              token: tokens[tokenIndex],
              agentName: 'Architecture Planner',
            });
            tokenIndex++;
          } else {
            clearInterval(tokenInterval);
            
            // Simulate phase completion
            setTimeout(() => {
              renderer.onEvent({
                type: 'phase_done',
                phaseId: 'planning-swarm',
                durationMs: 120000, // 2 minutes
              });
              
              // Finalize after a delay
              setTimeout(() => {
                renderer.finalize();
                console.log('\n\n✅ Enhanced pipeline rendering test complete!');
                console.log('The output demonstrates frontier-grade formatting with:');
                console.log('  • Structured logging with icons and types');
                console.log('  • Progress indicators and status bars');
                console.log('  • Clean key-value pair formatting');
                console.log('  • Real-time token streaming');
                console.log('  • Professional visual organization\n');
              }, 1000);
            }, 1000);
          }
        }, 100);
      }, 1000);
    }, 500);
  }, 500);
}, 4000); // Start phase 2 after phase 1 completes

// Keep the script running
setTimeout(() => {
  console.log('\nTest script completed.');
}, 20000);