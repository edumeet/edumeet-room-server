/**
 * Base class for load balancing strategies.
 */
export default abstract class LBStrategy {
}

/**
 * Available load balancing strategies.
 */
export const LB_STRATEGIES = Object.freeze({
	GEO: 'geo',
	STICKY: 'sticky'
});