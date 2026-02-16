/**
 * File-based logger that writes to disk in Node/Bun environments
 * Does nothing when running in a browser environment
 */

let fs: any = null
let path: any = null
let isNodeEnvironment = false

// Detect if we're in Node/Bun environment
try {
  if (typeof process !== "undefined" && process.versions?.node) {
    fs = require("node:fs")
    path = require("node:path")
    isNodeEnvironment = true
  }
} catch (e) {
  // Running in browser, do nothing
}

interface LoggerOptions {
  logDir?: string
  logFileName?: string
  bufferSize?: number // Number of log entries to buffer before writing
  flushInterval?: number // Time in ms to auto-flush buffer
}

export class FileLogger {
  private logFilePath: string | null = null
  private isEnabled: boolean = false
  private buffer: string[] = []
  private bufferSize: number = 100
  private flushInterval: number = 1000
  private flushTimer: any = null
  private writeStream: any = null

  constructor(options: LoggerOptions = {}) {
    if (!isNodeEnvironment || !fs || !path) {
      // Browser environment - logger is disabled
      return
    }

    this.bufferSize = options.bufferSize || 100
    this.flushInterval = options.flushInterval || 1000

    try {
      const logDir = options.logDir || path.join(process.cwd(), "logs")
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const logFileName = options.logFileName || `autorouter-${timestamp}.log`

      // Create logs directory if it doesn't exist
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }

      this.logFilePath = path.join(logDir, logFileName)

      // Create write stream for better performance
      this.writeStream = fs.createWriteStream(this.logFilePath, { flags: "a" })
      this.isEnabled = true

      // Start auto-flush timer
      this.startFlushTimer()

      // Write initial log entry
      this.log("FileLogger initialized", { logFilePath: this.logFilePath })
    } catch (error) {
      // Failed to initialize, silently disable
      this.isEnabled = false
    }
  }

  private startFlushTimer(): void {
    if (!isNodeEnvironment) return
    this.flushTimer = setInterval(() => {
      this.flush()
    }, this.flushInterval)
  }

  /**
   * Flush buffered logs to disk
   */
  flush(): void {
    if (!this.isEnabled || !this.writeStream || this.buffer.length === 0) return

    try {
      const content = this.buffer.join("")
      this.buffer = []
      this.writeStream.write(content)
    } catch (error) {
      // Silently fail - don't throw errors from logger
    }
  }

  /**
   * Log a message with optional data object
   */
  log(message: string, data?: any): void {
    if (!this.isEnabled || !this.logFilePath) return

    try {
      const timestamp = new Date().toISOString()
      let logEntry = `[${timestamp}] ${message}`

      if (data !== undefined) {
        logEntry += ` | ${JSON.stringify(data)}`
      }

      logEntry += "\n"

      this.buffer.push(logEntry)

      // Flush if buffer is full
      if (this.buffer.length >= this.bufferSize) {
        this.flush()
      }
    } catch (error) {
      // Silently fail - don't throw errors from logger
    }
  }

  /**
   * Log with a specific level
   */
  logLevel(level: string, message: string, data?: any): void {
    if (!this.isEnabled) return
    this.log(`[${level.toUpperCase()}] ${message}`, data)
  }

  info(message: string, data?: any): void {
    this.logLevel("info", message, data)
  }

  debug(message: string, data?: any): void {
    this.logLevel("debug", message, data)
  }

  warn(message: string, data?: any): void {
    this.logLevel("warn", message, data)
  }

  error(message: string, data?: any): void {
    this.logLevel("error", message, data)
  }

  /**
   * Close the logger and flush remaining logs
   */
  close(): void {
    if (!this.isEnabled) return

    try {
      // Clear flush timer
      if (this.flushTimer) {
        clearInterval(this.flushTimer)
        this.flushTimer = null
      }

      // Flush remaining logs synchronously if there's a buffer
      if (this.buffer.length > 0 && this.logFilePath && fs) {
        const content = this.buffer.join("")
        this.buffer = []
        // Write synchronously to ensure data is written before close
        fs.appendFileSync(this.logFilePath, content)
      }

      // Close write stream
      if (this.writeStream) {
        this.writeStream.end()
        this.writeStream = null
      }
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Check if logger is enabled (i.e., running in Node/Bun)
   */
  isActive(): boolean {
    return this.isEnabled
  }

  /**
   * Get the log file path
   */
  getLogPath(): string | null {
    return this.logFilePath
  }
}
