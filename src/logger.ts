const isProduction = process.env.NODE_ENV === 'production'

/**
 * Simple logger that only outputs messages when NODE_ENV is not 'production'.
 */
export const logger = {
  /**
   * Logs messages to the console if not in production.
   * @param {...any} args Arguments to log.
   */
  log: (...args: any[]) => {
    if (!isProduction) {
      console.log(...args)
    }
  },

  /**
   * Logs error messages to the console if not in production.
   * @param {...any} args Arguments to log as errors.
   */
  error: (...args: any[]) => {
    if (!isProduction) {
      console.error(...args)
    }
  },
}
