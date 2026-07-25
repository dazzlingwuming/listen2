/*
 * A deliberately small QR encoder for the Bilibili login payload.
 *
 * The login URL is ASCII and currently comfortably fits in QR version 10-L
 * (271 bytes of byte-mode payload). Keeping this local avoids sending a
 * short-lived login URL to a third-party QR image service.
 */
(function initBilibiliQrCode(global) {
  const VERSION = 10;
  const SIZE = VERSION * 4 + 17;
  const DATA_CODEWORDS = 274;
  const ERROR_CORRECTION_CODEWORDS = 18;
  const BLOCK_DATA_LENGTHS = [68, 68, 69, 69];
  const MAX_PAYLOAD_BYTES = 271;
  const FORMAT_ECL_LOW = 1;
  const FORMAT_MASK = 0;
  const FORMAT_POLYNOMIAL = 0x537;
  const FORMAT_MASK_PATTERN = 0x5412;
  const VERSION_POLYNOMIAL = 0x1f25;
  const ALIGNMENT_PATTERN_POSITIONS = [6, 28, 50];

  const gfExp = new Array(512);
  const gfLog = new Array(256);
  let fieldValue = 1;
  for (let index = 0; index < 255; index += 1) {
    gfExp[index] = fieldValue;
    gfLog[fieldValue] = index;
    fieldValue <<= 1;
    if (fieldValue & 0x100) {
      fieldValue ^= 0x11d;
    }
  }
  for (let index = 255; index < 512; index += 1) {
    gfExp[index] = gfExp[index - 255];
  }

  function getBchDigit(value) {
    let digit = 0;
    let current = value;
    while (current !== 0) {
      digit += 1;
      current >>>= 1;
    }
    return digit;
  }

  function getFormatBits(value) {
    let data = value << 10;
    while (getBchDigit(data) >= getBchDigit(FORMAT_POLYNOMIAL)) {
      data ^=
        FORMAT_POLYNOMIAL <<
        (getBchDigit(data) - getBchDigit(FORMAT_POLYNOMIAL));
    }
    return ((value << 10) | data) ^ FORMAT_MASK_PATTERN;
  }

  function getVersionBits(value) {
    let data = value << 12;
    while (getBchDigit(data) >= getBchDigit(VERSION_POLYNOMIAL)) {
      data ^=
        VERSION_POLYNOMIAL <<
        (getBchDigit(data) - getBchDigit(VERSION_POLYNOMIAL));
    }
    return (value << 12) | data;
  }

  function multiplyGalois(left, right) {
    if (left === 0 || right === 0) {
      return 0;
    }
    return gfExp[gfLog[left] + gfLog[right]];
  }

  function getReedSolomonDivisor(degree) {
    let divisor = [1];
    for (let index = 0; index < degree; index += 1) {
      const next = new Array(divisor.length + 1).fill(0);
      divisor.forEach((coefficient, coefficientIndex) => {
        next[coefficientIndex] ^= coefficient;
        next[coefficientIndex + 1] ^= multiplyGalois(coefficient, gfExp[index]);
      });
      divisor = next;
    }
    return divisor;
  }

  function getReedSolomonRemainder(data, degree) {
    const divisor = getReedSolomonDivisor(degree);
    const result = new Array(degree).fill(0);
    data.forEach((value) => {
      const factor = value ^ result.shift();
      result.push(0);
      for (let index = 0; index < degree; index += 1) {
        result[index] ^= multiplyGalois(divisor[index + 1], factor);
      }
    });
    return result;
  }

  function getUtf8Bytes(value) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(value));
    }
    return Array.from(unescape(encodeURIComponent(value))).map((character) =>
      character.charCodeAt(0)
    );
  }

  function appendBits(target, value, length) {
    for (let index = length - 1; index >= 0; index -= 1) {
      target.push((value >>> index) & 1);
    }
  }

  function createDataCodewords(payload) {
    const bits = [];
    appendBits(bits, 0x4, 4);
    appendBits(bits, payload.length, 16);
    payload.forEach((value) => appendBits(bits, value, 8));
    const capacityBits = DATA_CODEWORDS * 8;
    appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
    while (bits.length % 8 !== 0) {
      bits.push(0);
    }
    const data = [];
    for (let index = 0; index < bits.length; index += 8) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        byte = (byte << 1) | bits[index + bit];
      }
      data.push(byte);
    }
    let paddingIndex = 0;
    const padding = [0xec, 0x11];
    while (data.length < DATA_CODEWORDS) {
      data.push(padding[paddingIndex % padding.length]);
      paddingIndex += 1;
    }
    return data;
  }

  function interleaveCodewords(dataCodewords) {
    const blocks = [];
    let cursor = 0;
    BLOCK_DATA_LENGTHS.forEach((length) => {
      const data = dataCodewords.slice(cursor, cursor + length);
      cursor += length;
      blocks.push({
        data,
        ecc: getReedSolomonRemainder(data, ERROR_CORRECTION_CODEWORDS),
      });
    });
    const output = [];
    const maxDataLength = Math.max(...BLOCK_DATA_LENGTHS);
    for (let index = 0; index < maxDataLength; index += 1) {
      blocks.forEach((block) => {
        if (index < block.data.length) {
          output.push(block.data[index]);
        }
      });
    }
    for (let index = 0; index < ERROR_CORRECTION_CODEWORDS; index += 1) {
      blocks.forEach((block) => output.push(block.ecc[index]));
    }
    return output;
  }

  function createEmptyModules() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
  }

  function setupPositionProbePattern(modules, row, column) {
    for (let offsetRow = -1; offsetRow <= 7; offsetRow += 1) {
      for (let offsetColumn = -1; offsetColumn <= 7; offsetColumn += 1) {
        const targetRow = row + offsetRow;
        const targetColumn = column + offsetColumn;
        if (
          targetRow < 0 ||
          targetRow >= SIZE ||
          targetColumn < 0 ||
          targetColumn >= SIZE
        ) {
          continue;
        }
        modules[targetRow][targetColumn] =
          (offsetRow >= 0 &&
            offsetRow <= 6 &&
            (offsetColumn === 0 || offsetColumn === 6)) ||
          (offsetColumn >= 0 &&
            offsetColumn <= 6 &&
            (offsetRow === 0 || offsetRow === 6)) ||
          (offsetRow >= 2 &&
            offsetRow <= 4 &&
            offsetColumn >= 2 &&
            offsetColumn <= 4);
      }
    }
  }

  function setupTimingPattern(modules) {
    for (let index = 8; index < SIZE - 8; index += 1) {
      if (modules[index][6] === null) {
        modules[index][6] = index % 2 === 0;
      }
      if (modules[6][index] === null) {
        modules[6][index] = index % 2 === 0;
      }
    }
  }

  function setupPositionAdjustPattern(modules) {
    ALIGNMENT_PATTERN_POSITIONS.forEach((row) => {
      ALIGNMENT_PATTERN_POSITIONS.forEach((column) => {
        if (modules[row][column] !== null) {
          return;
        }
        for (let offsetRow = -2; offsetRow <= 2; offsetRow += 1) {
          for (let offsetColumn = -2; offsetColumn <= 2; offsetColumn += 1) {
            modules[row + offsetRow][column + offsetColumn] =
              offsetRow === -2 ||
              offsetRow === 2 ||
              offsetColumn === -2 ||
              offsetColumn === 2 ||
              (offsetRow === 0 && offsetColumn === 0);
          }
        }
      });
    });
  }

  function setupTypeInfo(modules) {
    const bits = getFormatBits((FORMAT_ECL_LOW << 3) | FORMAT_MASK);
    for (let index = 0; index < 15; index += 1) {
      const value = ((bits >>> index) & 1) === 1;
      if (index < 6) {
        modules[index][8] = value;
      } else if (index < 8) {
        modules[index + 1][8] = value;
      } else {
        modules[SIZE - 15 + index][8] = value;
      }
      if (index < 8) {
        modules[8][SIZE - index - 1] = value;
      } else if (index < 9) {
        modules[8][15 - index] = value;
      } else {
        modules[8][15 - index - 1] = value;
      }
    }
    modules[SIZE - 8][8] = true;
  }

  function setupVersionInfo(modules) {
    const bits = getVersionBits(VERSION);
    for (let index = 0; index < 18; index += 1) {
      const value = ((bits >>> index) & 1) === 1;
      modules[Math.floor(index / 3)][(index % 3) + SIZE - 11] = value;
      modules[(index % 3) + SIZE - 11][Math.floor(index / 3)] = value;
    }
  }

  function getMask(row, column) {
    return (row + column) % 2 === 0;
  }

  function mapData(modules, codewords) {
    let row = SIZE - 1;
    let direction = -1;
    let byteIndex = 0;
    let bitIndex = 7;
    for (let column = SIZE - 1; column > 0; column -= 2) {
      if (column === 6) {
        column -= 1;
      }
      while (true) {
        for (let offset = 0; offset < 2; offset += 1) {
          const targetColumn = column - offset;
          if (modules[row][targetColumn] !== null) {
            continue;
          }
          let dark = false;
          if (byteIndex < codewords.length) {
            dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
          }
          if (getMask(row, targetColumn)) {
            dark = !dark;
          }
          modules[row][targetColumn] = dark;
          bitIndex -= 1;
          if (bitIndex === -1) {
            byteIndex += 1;
            bitIndex = 7;
          }
        }
        row += direction;
        if (row < 0 || row >= SIZE) {
          row -= direction;
          direction = -direction;
          break;
        }
      }
    }
  }

  function createModules(text) {
    const bytes = getUtf8Bytes(String(text || ''));
    if (!bytes.length || bytes.length > MAX_PAYLOAD_BYTES) {
      throw new Error('The Bilibili QR payload is outside the supported size.');
    }
    const modules = createEmptyModules();
    setupPositionProbePattern(modules, 0, 0);
    setupPositionProbePattern(modules, SIZE - 7, 0);
    setupPositionProbePattern(modules, 0, SIZE - 7);
    setupPositionAdjustPattern(modules);
    setupTimingPattern(modules);
    setupTypeInfo(modules);
    setupVersionInfo(modules);
    mapData(modules, interleaveCodewords(createDataCodewords(bytes)));
    return modules;
  }

  function toSvg(text) {
    const modules = createModules(text);
    const cells = [];
    modules.forEach((row, rowIndex) => {
      row.forEach((dark, columnIndex) => {
        if (dark) {
          cells.push(`M${columnIndex},${rowIndex}h1v1h-1z`);
        }
      });
    });
    const quietZone = 4;
    const viewSize = SIZE + quietZone * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${quietZone} -${quietZone} ${viewSize} ${viewSize}" role="img" aria-label="Bilibili login QR code" shape-rendering="crispEdges" style="display:block;background:#fff;fill:#fff!important;stroke:none!important"><rect x="-${quietZone}" y="-${quietZone}" width="${viewSize}" height="${viewSize}" fill="#fff" style="fill:#fff!important;stroke:none!important"/><path d="${cells.join(
      ''
    )}" fill="#111827" style="fill:#111827!important;stroke:none!important"/></svg>`;
  }

  global.BilibiliQrCode = {
    maxPayloadBytes: MAX_PAYLOAD_BYTES,
    toSvg,
  };
})(window);
