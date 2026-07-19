// ── Enhanced Phase Interface ─────────────────────────────────────────────────
// Provides a clean interface for phase implementations to send formatted output
// to the pipeline renderer instead of using console.log directly.

export type PhaseLogger = (message: string, options?: {
  type?: 'info' | 'success' | 'warning' | 'error' | 'system';
  indent?: number;
  icon?: string;
}) => void;

export interface PhaseContext {
  /** Send a log message to the phase renderer */
  log: PhaseLogger;
  
  /** Send a progress update (0-100) */
  progress?: (percent: number, message?: string) => void;
  
  /** Send a data update (structured data for display) */
  data?: (key: string, value: any) => void;
}

// ── Phase Logger Implementation ──────────────────────────────────────────────
export class DefaultPhaseLogger implements PhaseLogger {
  private phaseId: string;
  private emitPhaseLine: (phaseId: string, line: string) => void;
  
  constructor(phaseId: string, emitPhaseLine: (phaseId: string, line: string) => void) {
    this.phaseId = phaseId;
    this.emitPhaseLine = emitPhaseLine;
  }
  
  log(message: string, options?: {
    type?: 'info' | 'success' | 'warning' | 'error' | 'system';
    indent?: number;
    icon?: string;
  }): void {
    const { type = 'info', indent = 0, icon } = options || {};
    
    // Format the message with appropriate styling
    let formatted = message;
    
    // Add icon if provided
    if (icon) {
      formatted = `${icon} ${formatted}`;
    }
    
    // Add indentation
    if (indent > 0) {
      formatted = '  '.repeat(indent) + formatted;
    }
    
    // Emit the formatted line
    this.emitPhaseLine(this.phaseId, formatted);
  }
}

// ── Utility functions for common phase logging patterns ──────────────────────
export const PhaseLogging = {
  /** Create a system message (phase starting, configuration, etc.) */
  system: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'system', icon: '⚙️' });
  },
  
  /** Create an info message (status updates, progress) */
  info: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'info', icon: 'ℹ️' });
  },
  
  /** Create a success message (completion, positive results) */
  success: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'success', icon: '✓' });
  },
  
  /** Create a warning message (non-critical issues, optimizations) */
  warning: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'warning', icon: '⚠️' });
  },
  
  /** Create an error message (failures, critical issues) */
  error: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'error', icon: '✗' });
  },
  
  /** Create a GPU/system info message */
  hardware: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'info', icon: '🖥️' });
  },
  
  /** Create an LLM/API call message */
  llm: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'info', icon: '🧠' });
  },
  
  /** Create a file operation message */
  file: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'info', icon: '📁' });
  },
  
  /** Create a task/progress message */
  task: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'info', icon: '📋' });
  },
  
  /** Create a security message */
  security: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'warning', icon: '🔒' });
  },
  
  /** Create a batch/parallel operation message */
  batch: (message: string, logger: PhaseLogger): void => {
    logger(message, { type: 'info', icon: '⚡' });
  },
  
  /** Create a key-value pair display */
  kv: (key: string, value: any, logger: PhaseLogger, indent: number = 1): void => {
    const formattedValue = typeof value === 'number' ? value.toString() : 
                          typeof value === 'boolean' ? (value ? 'Yes' : 'No') : 
                          String(value);
    logger(`${key}: ${formattedValue}`, { indent });
  },
  
  /** Create a section header */
  section: (title: string, logger: PhaseLogger): void => {
    logger(title, { type: 'system', icon: '┃' });
  },
  
  /** Create a divider/separator */
  divider: (logger: PhaseLogger, length: number = 40): void => {
    logger('─'.repeat(length), { type: 'system' });
  },
};

// ── Enhanced phase executor wrapper ──────────────────────────────────────────
/**
 * Wraps a phase function to provide enhanced logging capabilities
 * This allows phase implementations to use the enhanced logging system
 * while maintaining backward compatibility
 */
export function withEnhancedLogging<P extends any[], R>(
  phaseId: string,
  phaseFn: (config: any, ...args: [...P, PhaseContext]) => Promise<R>,
  emitPhaseLine: (phaseId: string, line: string) => void
): (config: any, ...args: P) => Promise<R> {
  return async (config: any, ...args: P): Promise<R> => {
    const logger = new DefaultPhaseLogger(phaseId, emitPhaseLine);
    const context: PhaseContext = {
      log: logger.log.bind(logger),
    };
    
    return phaseFn(config, ...args, context);
  };
}