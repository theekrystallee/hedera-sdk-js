import {
    TokenCreateTransaction,
    TokenInfoQuery,
    TokenType,
    PrivateKey,
    Client,
    AccountId,
    TokenUpdateTransaction,
} from "@hashgraph/sdk";
import dotenv from "dotenv";

dotenv.config();

/**
 * @notice E2E-HIP-646
 * @url https://hips.hedera.com/hip/hip-646
 */
async function main() {
    if (
        !process.env.OPERATOR_KEY ||
        !process.env.OPERATOR_ID ||
        !process.env.HEDERA_NETWORK
    ) {
        throw new Error("Please set required keys in .env file.");
    }

    const operatorId = AccountId.fromString(process.env.OPERATOR_ID);
    const operatorKey = PrivateKey.fromStringDer(process.env.OPERATOR_KEY);
    const network = process.env.HEDERA_NETWORK;
    const client = Client.forName(network).setOperator(operatorId, operatorKey);

    // Generate a supply key
    const adminKey = PrivateKey.fromStringDer(process.env.OPERATOR_KEY);
    // Initial metadata
    const metadata = new Uint8Array([1]);
    // New metadata
    const newMetadata = new Uint8Array([1, 2]);

    let tokenInfo;

    try {
        // Create a non fungible token
        let createTokenTx = new TokenCreateTransaction()
            .setTokenName("Test")
            .setTokenSymbol("T")
            .setMetadata(metadata)
            .setTokenType(TokenType.FungibleCommon)
            .setDecimals(3)
            .setInitialSupply(10000)
            .setTreasuryAccountId(operatorId)
            .setAdminKey(adminKey)
            .freezeWith(client);

        // Sign and execute create token transaction
        const tokenCreateTxResponse = await (
            await createTokenTx.sign(operatorKey)
        ).execute(client);

        // Get receipt for create token transaction
        const tokenCreateTxReceipt =
            await tokenCreateTxResponse.getReceipt(client);
        console.log(
            `Status of token create transction: ${tokenCreateTxReceipt.status.toString()}`,
        );

        // Get token id
        const tokenId = tokenCreateTxReceipt.tokenId;
        console.log(`Token id: ${tokenId.toString()}`);

        // Get token info
        tokenInfo = await new TokenInfoQuery()
            .setTokenId(tokenId)
            .execute(client);
        console.log(`Token metadata:`, tokenInfo.metadata);

        const tokenUpdateTx = new TokenUpdateTransaction()
            .setTokenId(tokenId)
            .setMetadata(newMetadata)
            .freezeWith(client);

        // Sign transactions with metadata key and execute it
        const tokenUpdateTxResponse = await (
            await tokenUpdateTx.sign(adminKey)
        ).execute(client);

        // Get receipt for token update transaction
        const tokenUpdateTxReceipt =
            await tokenUpdateTxResponse.getReceipt(client);
        console.log(
            `Status of token update transction: ${tokenUpdateTxReceipt.status.toString()}`,
        );

        tokenInfo = await new TokenInfoQuery()
            .setTokenId(tokenId)
            .execute(client);
        console.log(`Token updated metadata:`, tokenInfo.metadata);
    } catch (error) {
        console.log(error);
    }

    client.close();
}

void main();
