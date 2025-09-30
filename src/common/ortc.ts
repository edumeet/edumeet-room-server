import { MediaKind } from 'edumeet-common';
import * as h264 from 'h264-profile-level-id';
import { RtpCapabilities, RtpCodecCapability, RtcpFeedback, RtpHeaderExtension, RtpParameters, RtpCodecParameters } from 'mediasoup/types';

/**
 * Validates RtpCapabilities. It may modify given data by adding missing
 * fields with default values.
 * It throws if invalid.
 */
export function validateRtpCapabilities(caps: RtpCapabilities): void {
	if (typeof caps !== 'object') {
		throw new TypeError('caps is not an object');
	}

	// codecs is optional. If unset, fill with an empty array.
	if (caps.codecs && !Array.isArray(caps.codecs)) {
		throw new TypeError('caps.codecs is not an array');
	} else if (!caps.codecs) {
		caps.codecs = [];
	}

	for (const codec of caps.codecs) {
		validateRtpCodecCapability(codec);
	}

	// headerExtensions is optional. If unset, fill with an empty array.
	if (caps.headerExtensions && !Array.isArray(caps.headerExtensions)) {
		throw new TypeError('caps.headerExtensions is not an array');
	} else if (!caps.headerExtensions) {
		caps.headerExtensions = [];
	}

	for (const ext of caps.headerExtensions) {
		validateRtpHeaderExtension(ext);
	}
}

/**
 * Validates RtpCodecCapability. It may modify given data by adding missing
 * fields with default values.
 * It throws if invalid.
 */
export function validateRtpCodecCapability(codec: RtpCodecCapability): void {
	const MimeTypeRegex = new RegExp('^(audio|video)/(.+)', 'i');

	if (typeof codec !== 'object') {
		throw new TypeError('codec is not an object');
	}

	// mimeType is mandatory.
	if (!codec.mimeType || typeof codec.mimeType !== 'string') {
		throw new TypeError('missing codec.mimeType');
	}

	const mimeTypeMatch = MimeTypeRegex.exec(codec.mimeType);

	if (!mimeTypeMatch) {
		throw new TypeError('invalid codec.mimeType');
	}

	// Just override kind with media component of mimeType.
	codec.kind = mimeTypeMatch[1].toLowerCase() as MediaKind;

	// preferredPayloadType is optional.
	if (codec.preferredPayloadType && typeof codec.preferredPayloadType !== 'number') {
		throw new TypeError('invalid codec.preferredPayloadType');
	}

	// clockRate is mandatory.
	if (typeof codec.clockRate !== 'number') {
		throw new TypeError('missing codec.clockRate');
	}

	// channels is optional. If unset, set it to 1 (just if audio).
	if (codec.kind === 'audio') {
		if (typeof codec.channels !== 'number') {
			codec.channels = 1;
		}
	} else {
		delete codec.channels;
	}

	// parameters is optional. If unset, set it to an empty object.
	if (!codec.parameters || typeof codec.parameters !== 'object') {
		codec.parameters = {};
	}

	for (const key of Object.keys(codec.parameters)) {
		let value = codec.parameters[key];

		if (value === undefined) {
			codec.parameters[key] = '';
			value = '';
		}

		if (typeof value !== 'string' && typeof value !== 'number') {
			throw new TypeError(
				`invalid codec parameter [key:${key}s, value:${value}]`);
		}

		// Specific parameters validation.
		if (key === 'apt') {
			if (typeof value !== 'number') {
				throw new TypeError('invalid codec apt parameter');
			}
		}
	}

	// rtcpFeedback is optional. If unset, set it to an empty array.
	if (!codec.rtcpFeedback || !Array.isArray(codec.rtcpFeedback)) {
		codec.rtcpFeedback = [];
	}

	for (const fb of codec.rtcpFeedback) {
		validateRtcpFeedback(fb);
	}
}

/**
 * Validates RtcpFeedback. It may modify given data by adding missing
 * fields with default values.
 * It throws if invalid.
 */
export function validateRtcpFeedback(fb: RtcpFeedback): void {
	if (typeof fb !== 'object') {
		throw new TypeError('fb is not an object');
	}

	// type is mandatory.
	if (!fb.type || typeof fb.type !== 'string') {
		throw new TypeError('missing fb.type');
	}

	// parameter is optional. If unset set it to an empty string.
	if (!fb.parameter || typeof fb.parameter !== 'string') {
		fb.parameter = '';
	}
}

/**
 * Validates RtpHeaderExtension. It may modify given data by adding missing
 * fields with default values.
 * It throws if invalid.
 */
export function validateRtpHeaderExtension(ext: RtpHeaderExtension): void {

	if (typeof ext !== 'object') {
		throw new TypeError('ext is not an object');
	}

	if (ext.kind !== 'audio' && ext.kind !== 'video') {
		throw new TypeError('invalid ext.kind');
	}

	// uri is mandatory.
	if (!ext.uri || typeof ext.uri !== 'string') {
		throw new TypeError('missing ext.uri');
	}

	// preferredId is mandatory.
	if (typeof ext.preferredId !== 'number') {
		throw new TypeError('missing ext.preferredId');
	}

	// preferredEncrypt is optional. If unset set it to false.
	if (ext.preferredEncrypt && typeof ext.preferredEncrypt !== 'boolean') {
		throw new TypeError('invalid ext.preferredEncrypt');
	} else if (!ext.preferredEncrypt) {
		ext.preferredEncrypt = false;
	}

	// direction is optional. If unset set it to sendrecv.
	if (ext.direction && typeof ext.direction !== 'string') {
		throw new TypeError('invalid ext.direction');
	} else if (!ext.direction) {
		ext.direction = 'sendrecv';
	}
}

/**
 * Check whether the given RTP capabilities can consume the given Producer.
 */
export function canConsume(
	consumableParams: RtpParameters,
	caps: RtpCapabilities
): boolean {
	// This may throw.
	validateRtpCapabilities(caps);

	const matchingCodecs: RtpCodecParameters[] = [];

	for (const codec of consumableParams.codecs) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any
		const matchedCapCodec = caps.codecs!.find((capCodec: any) => matchCodecs(capCodec, codec, { strict: true }));

		if (!matchedCapCodec) {
			continue;
		}

		matchingCodecs.push(codec);
	}

	// Ensure there is at least one media codec.
	if (matchingCodecs.length === 0 || isRtxCodec(matchingCodecs[0])) {
		return false;
	}

	return true;
}

function isRtxCodec(codec: RtpCodecCapability | RtpCodecParameters): boolean {
	return /.+\/rtx$/i.test(codec.mimeType);
}

function matchCodecs(
	aCodec: RtpCodecCapability | RtpCodecParameters,
	bCodec: RtpCodecCapability | RtpCodecParameters,
	{ strict = false, modify = false } = {}
): boolean {
	
	const aMimeType = aCodec.mimeType.toLowerCase();
	const bMimeType = bCodec.mimeType.toLowerCase();

	if (aMimeType !== bMimeType) {
		return false;
	}

	if (aCodec.clockRate !== bCodec.clockRate) {
		return false;
	}

	if (aCodec.channels !== bCodec.channels) {
		return false;
	}

	if (!aCodec.parameters)
		return false;
	if (!bCodec.parameters)
		return false;

	// Per codec special checks.
	switch (aMimeType) {
		case 'audio/multiopus':
		{
			const aNumStreams = aCodec.parameters['num_streams'];
			const bNumStreams = bCodec.parameters['num_streams'];

			if (aNumStreams !== bNumStreams) {
				return false;
			}

			const aCoupledStreams = aCodec.parameters['coupled_streams'];
			const bCoupledStreams = bCodec.parameters['coupled_streams'];

			if (aCoupledStreams !== bCoupledStreams) {
				return false;
			}

			break;
		}

		case 'video/h264':
		case 'video/h264-svc':
		{
			if (strict) {
				const aPacketizationMode = aCodec.parameters['packetization-mode'] || 0;
				const bPacketizationMode = bCodec.parameters['packetization-mode'] || 0;

				if (aPacketizationMode !== bPacketizationMode) {
					return false;
				}

				if (!h264.isSameProfile(aCodec.parameters, bCodec.parameters)) {
					return false;
				}

				let selectedProfileLevelId;

				try {
					selectedProfileLevelId =
						h264.generateProfileLevelIdForAnswer(aCodec.parameters, bCodec.parameters);
				} catch (error) {
					return false;
				}

				if (modify) {
					if (selectedProfileLevelId) {
						aCodec.parameters['profile-level-id'] = selectedProfileLevelId;
					} else {
						delete aCodec.parameters['profile-level-id'];
					}
				}
			}

			break;
		}

		case 'video/vp9':
		{
			if (strict) {
				const aProfileId = aCodec.parameters['profile-id'] || 0;
				const bProfileId = bCodec.parameters['profile-id'] || 0;

				if (aProfileId !== bProfileId) {
					return false;
				}
			}

			break;
		}
	}

	return true;
}
