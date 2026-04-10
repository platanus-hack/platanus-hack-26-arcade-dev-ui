import { createHash } from 'crypto';
import { readFileSync } from 'fs';

const DEFAULT_COVER_SHA256 =
  'b97a843d173c8fe4bfccbb7645d54d174a19f69dcd02b10af3111df07744a642';
const MAX_COVER_BYTES = 500 * 1024;

export type CoverCheckResult = {
  exists: boolean;
  isChanged: boolean;
  isPNG: boolean;
  width: number;
  height: number;
  isValidSize: boolean;
  sizeBytes: number;
  isValidFileSize: boolean;
  isValid: boolean;
  message: string;
};

function checkPNGDimensions(buffer: Buffer): {
  width: number;
  height: number;
  isPNG: boolean;
} {
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  if (!buffer.subarray(0, 8).equals(pngSignature)) {
    return { width: 0, height: 0, isPNG: false };
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    isPNG: true,
  };
}

export function getCoverCheckResult(
  coverPath: string = './cover.png',
): CoverCheckResult {
  try {
    const coverBuffer = readFileSync(coverPath);
    const coverHash = createHash('sha256').update(coverBuffer).digest('hex');
    const isChanged = coverHash !== DEFAULT_COVER_SHA256;
    const sizeBytes = coverBuffer.byteLength;
    const { width, height, isPNG } = checkPNGDimensions(coverBuffer);
    const isValidSize = width === 800 && height === 600;
    const isValidFileSize = sizeBytes <= MAX_COVER_BYTES;

    let message = '';
    let isValid = false;

    if (!isPNG) {
      message = 'cover.png is not a valid PNG file';
    } else if (!isChanged) {
      message = 'Default cover detected';
    } else if (!isValidSize) {
      message = `Cover is ${width}x${height}, must be 800x600`;
    } else if (!isValidFileSize) {
      message = `Cover is ${(sizeBytes / 1024).toFixed(1)} KB, must be 500 KB or less`;
    } else {
      message = 'Custom cover provided';
      isValid = true;
    }

    return {
      exists: true,
      isChanged,
      isPNG,
      width,
      height,
      isValidSize,
      sizeBytes,
      isValidFileSize,
      isValid,
      message,
    };
  } catch {
    return {
      exists: false,
      isChanged: false,
      isPNG: false,
      width: 0,
      height: 0,
      isValidSize: false,
      sizeBytes: 0,
      isValidFileSize: false,
      isValid: false,
      message: 'cover.png not found',
    };
  }
}
