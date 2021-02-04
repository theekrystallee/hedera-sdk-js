import * as bip39 from "bip39";
import { Ed25519PrivateKey } from "./Ed25519PrivateKey";
import { MnemonicValidationResult } from "./MnemonicValidationResult";
import { MnemonicValidationStatus } from "./MnemonicValidationStatus";
import legacyWordList from "./legacyWordList";
import BigNumber from "bignumber.js";
import { HashAlgorithm } from "./Hmac";
import { Pbkdf2 } from "./Pbkdf2";
import { Sha256 } from "./Sha256";
import { legacyDeriveChildKey } from "./util";

/** result of `generateMnemonic()` */
export class Mnemonic {
    public readonly _isLegacy: boolean = false;
    public readonly words: string[];

    /**
     * Recover a mnemonic from a list of 24 words.
     *
     * @param words
     */
    public constructor(words: string[]) {
        if (words.length === 22) {
            this._isLegacy = true;
        }
        this.words = words;
    }

    /** Lazily generate the key, providing an optional passphrase to protect it with */
    public toPrivateKey(passphrase: string): Promise<Ed25519PrivateKey> {
        return Ed25519PrivateKey.fromMnemonic(this, passphrase);
    }

    /**
     * Legacy 22 word mnemonic
     */
    public async toLegacyPrivateKey(): Promise<Ed25519PrivateKey> {
        const index = this._isLegacy ? -1 : 0;
        const entropy = this._isLegacy ? this._toLegacyEntropy()! : await this._toLegacyEntropy2()!;
        const keyBytes = await legacyDeriveChildKey(entropy, index);

        return Ed25519PrivateKey.fromBytes(keyBytes);
    }

    /**
     * Generate a random 24-word mnemonic.
     *
     * If you are happy with the mnemonic produced you can call {@link .toPrivateKey} on the
     * returned object.
     *
     * This mnemonics that are compatible with the Android and iOS mobile wallets.
     *
     * **NOTE:** Mnemonics must be saved separately as they cannot be later recovered from a given
     * key.
     */
    public static generate(): Mnemonic {
        // 256-bit entropy gives us 24 words
        return new Mnemonic(bip39.generateMnemonic(256).split(" "));
    }

    /**
     * Recover a mnemonic phrase from a string, splitting on spaces.
     *
     * @param mnemonic
     */
    public static fromString(mnemonic: string): Mnemonic {
        return new Mnemonic(mnemonic.split(" "));
    }

    /**
     * Validate that this is a valid BIP-39 mnemonic as generated by BIP-39's rules.
     * <p>
     * Technically, invalid mnemonics can still be used to generate valid private keys,
     * but if they became invalid due to user error then it will be difficult for the user
     * to tell the difference unless they compare the generated keys.
     * <p>
     * During validation, the following conditions are checked in order:
     * <ol>
     *     <li>{@link this.words.length} == 24</li>
     *     <li>All strings in {@link this.words} exist in the BIP-39 standard English word list (no normalization is done).</li>
     *     <li>The calculated checksum for the mnemonic equals the checksum encoded in the mnemonic.</li>
     * </ol>
     * <p>
     *
     * @return the result of the validation.
     * @see {@link https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki | Bitcoin Improvement Project proposal 39 (BIP-39) }
     * @see {@link https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt | BIP-39 English word list }
     */
    public validate(): MnemonicValidationResult {
        if (this._isLegacy) {
            return this._validateLegacy();
        }

        if (this.words.length !== 24) {
            return new MnemonicValidationResult(MnemonicValidationStatus.BadLength);
        }

        const unknownIndices = this.words.reduce(
            (unknowns: number[], word, index) =>
                // eslint-disable-next-line implicit-arrow-linebreak
                bip39.wordlists.english.includes(word) ?
                    unknowns :
                    [ ...unknowns, index ],
            []
        );

        if (unknownIndices.length > 0) {
            return new MnemonicValidationResult(
                MnemonicValidationStatus.UnknownWords,
                unknownIndices
            );
        }

        // this would cover length and unknown words but it only gives us a `boolean`
        // we validate those first and then let `bip39` do the non-trivial checksum verification
        if (
            !bip39.validateMnemonic(
                this.words.join(" "),
                bip39.wordlists.english
            )
        ) {
            return new MnemonicValidationResult(MnemonicValidationStatus.ChecksumMismatch);
        }

        return new MnemonicValidationResult(MnemonicValidationStatus.Ok);
    }

    /**
     * Validate that this is a valid legacy mnemonic as generated by the Android and iOS wallets.
     * <p>
     * Technically, invalid mnemonics can still be used to generate valid private keys,
     * but if they became invalid due to user error then it will be difficult for the user
     * to tell the difference unless they compare the generated keys.
     * <p>
     * During validation, the following conditions are checked in order:
     * <ol>
     *     <li>{@link this.words.length} == 22</li>
     *     <li>All strings in {@link this.words} exist in the legacy word list (no normalization is done).</li>
     *     <li>The calculated checksum for the mnemonic equals the checksum encoded in the mnemonic.</li>
     * </ol>
     * <p>
     *
     * @return the result of the validation.
     */
    private _validateLegacy(): MnemonicValidationResult {
        if (!this._isLegacy) {
            throw new Error("`validateLegacy` cannot be called on non-legacy mnemonics");
        }

        const unknownIndices = this.words.reduce(
            (unknowns: number[], word, index) =>
                // eslint-disable-next-line implicit-arrow-linebreak
                legacyWordList.includes(word) ? unknowns : [ ...unknowns, index ],
            []
        );

        if (unknownIndices.length > 0) {
            return new MnemonicValidationResult(
                MnemonicValidationStatus.UnknownLegacyWords,
                unknownIndices
            );
        }

        // Checksum validation
        // We already made sure all the words are valid so if this is null we know it was due to the checksum
        try {
            this._toLegacyEntropy();
        } catch {
            return new MnemonicValidationResult(MnemonicValidationStatus.ChecksumMismatch);
        }

        return new MnemonicValidationResult(MnemonicValidationStatus.Ok);
    }

    private _toLegacyEntropy(): Uint8Array {
        const numWords = this.words.length;
        const len256Bits = Math.ceil((256 + 8) / Math.log2(legacyWordList.length));

        if (numWords !== len256Bits) {
            throw new Error(`there should be ${len256Bits} words, not ${numWords}`);
        }

        const indicies = this.words.map((word) => legacyWordList.indexOf(word.toLowerCase()));
        const data = _convertRadix(indicies, legacyWordList.length, 256, 33);
        const crc = data[ data.length - 1 ];
        const result = new Uint8Array(data.length - 1);
        for (let i = 0; i < data.length - 1; i += 1) {
            result[ i ] = data[ i ] ^ crc;
        }

        const crc2 = _crc8(result);
        if (crc !== crc2) {
            throw new Error("Invalid legacy mnemonic: fails the cyclic redundency check");
        }

        return result;
    }

    private async _toLegacyEntropy2(): Promise<Uint8Array> {
        const concatBitsLen = this.words.length * 11;
        const concatBits: boolean[] = [];
        concatBits.fill(false, 0, concatBitsLen);

        for (const [ wordIndex, word ] of this.words.entries()) {
            const index = bip39.wordlists.english.indexOf(word.toLowerCase());

            if (index < 0) {
                throw new Error(`Word not found in wordlist: ${word}`);
            }

            for (let i = 0; i < 11; i += 1) {
                concatBits[ (wordIndex * 11) + i ] = (index & (1 << (10 - i))) !== 0;
            }
        }

        const checksumBitsLen = concatBitsLen / 33;
        const entropyBitsLen = concatBitsLen - checksumBitsLen;

        const entropy = new Uint8Array(entropyBitsLen / 8);

        for (let i = 0; i < entropyBitsLen; i += 1) {
            for (let j = 0; j < 8; j += 1) {
                if (concatBits[ (i * 8) + j ]) {
                    entropy[ i ] |= 1 << (7 - j);
                }
            }
        }

        // Checksum validation
        const hash = await Sha256.hash(entropy);
        const hashBits = bytesToBits(hash);

        for (let i = 0; i < checksumBitsLen; i += 1) {
            if (concatBits[ entropyBitsLen + i ] !== hashBits[ i ]) {
                throw new Error("Checksum mismatch");
            }
        }

        return entropy;
    }

    public toString(): string {
        return this.words.join(" ");
    }
}

function _crc8(data: Uint8Array): number {
    let crc = 0xFF;

    for (let i = 0; i < data.length - 1; i += 1) {
        crc ^= data[ i ];
        for (let j = 0; j < 8; j += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xB2);
        }
    }

    return crc ^ 0xFF;
}

function _convertRadix(
    nums: number[],
    fromRadix: number,
    toRadix: number,
    toLength: number
): Uint8Array {
    let num = new BigNumber(0);
    for (const element of nums) {
        num = num.times(fromRadix);
        num = num.plus(element);
    }
    const result = new Uint8Array(toLength);
    for (let i = toLength - 1; i >= 0; i -= 1) {
        const tem = num.dividedToIntegerBy(toRadix);
        const rem = num.modulo(toRadix);
        num = tem;
        result[ i ] = rem.toNumber();
    }
    return result;
}

function bytesToBits(data: Uint8Array): boolean[] {
    const bits: boolean[] = [];
    bits.fill(false, 0, data.length * 8);

    // eslint-disable-next-line unicorn/no-for-loop
    for (let i = 0; i < data.length; i += 1) {
        for (let j = 0; j < 8; j += 1) {
            bits[ (i * 8) + j ] = (data[ i ] & (1 << (7 - j))) !== 0;
        }
    }

    return bits;
}
