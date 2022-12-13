import {
    AccountBalanceQuery,
    Status,
    TokenCreateTransaction,
} from "../../src/exports.js";
import IntegrationTestEnv, {
    Client,
    skipTestDueToNodeJsVersion,
} from "./client/NodeIntegrationTestEnv.js";

describe("AccountBalanceQuery", function () {
    let clientPreviewNet;
    let clientTestnet;
    let env;

    before(async function () {
        clientPreviewNet = Client.forPreviewnet().setTransportSecurity(true);
        clientTestnet = Client.forTestnet().setTransportSecurity(true);
        env = await IntegrationTestEnv.new({ throwaway: true });
    });

    it("can connect to previewnet with TLS", async function () {
        this.timeout(30000);
        if (skipTestDueToNodeJsVersion(16)) {
            return;
        }

        for (const [address, nodeAccountId] of Object.entries(
            clientPreviewNet.network
        )) {
            expect(address.endsWith(":50212")).to.be.true;

            await new AccountBalanceQuery()
                .setAccountId(nodeAccountId)
                .setMaxAttempts(10)
                .execute(clientPreviewNet);
        }
    });

    it("can connect to testnet with TLS", async function () {
        this.timeout(30000);

        if (skipTestDueToNodeJsVersion(16)) {
            return;
        }

        for (const [address, nodeAccountId] of Object.entries(
            clientTestnet.network
        )) {
            expect(address.endsWith(":50212")).to.be.true;

            await new AccountBalanceQuery()
                .setAccountId(nodeAccountId)
                .setMaxAttempts(10)
                .execute(clientTestnet);
        }
    });

    it("an account that does not exist should return an error", async function () {
        this.timeout(120000);

        let err = false;

        try {
            await new AccountBalanceQuery()
                .setAccountId("1.0.3")
                .execute(env.client);
        } catch (error) {
            err = error.toString().includes(Status.InvalidAccountId.toString());
        }

        if (!err) {
            throw new Error("query did not error");
        }
    });

    it("should reflect token with no keys", async function () {
        this.timeout(120000);

        const operatorId = env.operatorId;

        const token = (
            await (
                await new TokenCreateTransaction()
                    .setTokenName("ffff")
                    .setTokenSymbol("F")
                    .setTreasuryAccountId(operatorId)
                    .execute(env.client)
            ).getReceipt(env.client)
        ).tokenId;

        const balances = await new AccountBalanceQuery()
            .setAccountId(env.operatorId)
            .execute(env.client);

        expect(balances.tokens.get(token).toInt()).to.be.equal(0);
    });

    after(async function () {
        clientPreviewNet.close();
        clientTestnet.close();
        await env.close();
    });
});
