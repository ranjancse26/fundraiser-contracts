'use strict';

import expectThrow from './helpers/expectThrow';
import advanceBlock from './helpers/advanceBlock';
import advanceTime from './helpers/advanceTime';
import latestTimestamp from './helpers/latestTimestamp';
const Fundraiser = artifacts.require("./FabricTokenFundraiser.sol");
const FundraiserUT = artifacts.require("./testing/FundraiserUT.sol");
const FabricTokenSafe = artifacts.require("./FabricTokenSafe.sol");

const BigNumber = web3.BigNumber

const should = require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bignumber')(BigNumber))
    .should()

contract('Fundraiser', function (accounts) {
    const initialConversionRate = 3000;
    const hardCap = 10 ** 5;
    let token;
    let now;
    let oneDayBefore, oneDayAfter, twoDaysAfter;

    function updateTimestamps() {
        now = latestTimestamp();
        oneDayBefore = now - 24 * 3600;
        oneDayAfter = now + 24 * 3600;
        twoDaysAfter = now + 24 * 3600;
    }

    before(async function () {
        //Advance to the next block to correctly read time in the solidity "now" function interpreted by testrpc
        await advanceBlock()
        updateTimestamps();
    });

    describe('contract construction', function () {
        it('should throw an error if no beneficiary is set', async function () {
            await expectThrow(Fundraiser.new(0));
        });

        it('should throw an error if no beneficiary is set', async function () {
            await expectThrow(FundraiserUT.new(0, initialConversionRate, oneDayBefore, oneDayAfter, hardCap));
        });
    });

    describe('handling the beneficiary', function () {
        beforeEach(async function () {
            token = await Fundraiser.new(accounts[0]);
        });

        it('should return the proper beneficiary when created', async function () {
            let beneficiary = await token.beneficiary.call();
            assert.equal(beneficiary, accounts[0], 'should be the one set druring creation');
        });

        it('should not allow to set zero address beneficiary', async function () {
            await expectThrow(token.setBeneficiary(0));
        });

        it('should allow to change beneficiary', async function () {
            await token.setBeneficiary(accounts[1]);
            let beneficiary = await token.beneficiary.call();
            assert.equal(beneficiary, accounts[1], 'should be changed');
        });

        it('should not allow anyone other than the owner to change beneficiary', async function () {
            await expectThrow(token.setBeneficiary(accounts[1], { from: accounts[1] }));
        });
    });

    describe('before the fundraiser begin', function () {
        beforeEach(async function () {
            token = await FundraiserUT.new(accounts[0], initialConversionRate, oneDayAfter, twoDaysAfter, hardCap);
        });

        it('should allow to change conversion rate by the owner', async function () {
            let result = await token.setConversionRate(1000);
            assert.equal(result.logs.length, 1);
            assert.equal(result.logs[0].event, 'ConversionRateChange');
            assert.equal(result.logs[0].args._conversionRate, 1000);
            let conversionRate = await token.conversionRate.call();
            assert.equal(conversionRate, 1000)
        });

        it('should allow to whitelist entries', async function () {
            await token.whitelistAddresses([accounts[1], accounts[2]]);
            assert.equal(await token.whitelist.call(accounts[1]), true);
            assert.equal(await token.whitelist.call(accounts[2]), true);
        });

        it('should not allow to change conversion rate to zero', async function () {
            await expectThrow(token.setConversionRate(0));
        });

        it('should not allow to change conversion rate by someone other than the owner', async function () {
            await expectThrow(token.setConversionRate(1000, { from: accounts[1] }));
        });

        it('should not allow anyone to create tokens by sending ether to contract', async function () {
            await expectThrow(token.send(10));
        });

        it('should not allow anyone to create tokens by sending ether to #buyTokens()', async function () {
            await expectThrow(token.buyTokens({ value: 10 }));
        });

        it('should not allow to finalize the fundraiser', async function () {
            await expectThrow(token.finalize());
        });
    });

    describe('during the fundraiser', function () {
        beforeEach(async function () {
            token = await FundraiserUT.new(accounts[0], initialConversionRate, oneDayBefore, oneDayAfter, hardCap);
            await token.whitelistAddresses([accounts[0], accounts[1], accounts[2]]);
        });

        it('should not allow owner to change conversion rate', async function () {
            await expectThrow(token.setConversionRate(1000));
        });

        it('should not allow anyone else to change conversion rate', async function () {
            await expectThrow(token.setConversionRate(1000, { from: accounts[1] }));
        });

        it('should not allow to finalize the fundraiser', async function () {
            await expectThrow(token.finalize());
        });

        it('should allow to finalize the fundraiser if the hardcap is reached', async function () {
            let ethersHardCap = Math.ceil(hardCap / initialConversionRate);
            let result = await token.send(ethersHardCap);
            await token.finalize();
            let isFinalized = await token.finalized.call();
            assert.strictEqual(isFinalized, true);
        });

        it('should transfer the correct amount of ether to the beneficiary', async function () {
            token = await FundraiserUT.new(accounts[9], initialConversionRate, oneDayBefore, oneDayAfter, hardCap);
            await token.whitelistAddresses([accounts[1]]);

            let ethersHardCap = Math.ceil(hardCap / initialConversionRate);
            let result = await token.sendTransaction({ value: ethersHardCap, from: accounts[1] });
            let initialBeneficiaryBalance = web3.eth.getBalance(accounts[9]);
            await token.finalize(); // Finalize based on hard cap
            let beneficiaryBalance = web3.eth.getBalance(accounts[9]);
            beneficiaryBalance.minus(initialBeneficiaryBalance).should.be.bignumber.equal(ethersHardCap);
        });

        it('should transfer the correct amount of tokens for the bounty program to the owner', async function () {
            token = await FundraiserUT.new(accounts[9], initialConversionRate, oneDayBefore, oneDayAfter, hardCap);
            await token.whitelistAddresses([accounts[1]]);

            let ethersHardCap = Math.ceil(hardCap / initialConversionRate);
            let result = await token.sendTransaction({ value: ethersHardCap, from: accounts[1] });
            let initialBeneficiaryBalance = web3.eth.getBalance(accounts[9]);
            await token.finalize(); // Finalize based on hard cap
            let ownerTokensBalance = await token.balanceOf.call(accounts[0]);
            let expectedBountyTokens = new BigNumber("10").pow(6 + 18);
            ownerTokensBalance.should.be.bignumber.equal(expectedBountyTokens);
        });

        it('should not allow any transfers after the hardcap is reached', async function () {
            let ethersHardCap = Math.ceil(hardCap / initialConversionRate);
            let result = await token.send(ethersHardCap);
            await expectThrow(token.send(1));
            await expectThrow(token.sendTransaction({ value: 1, from: accounts[1] }));
            await expectThrow(token.buyTokens({ value: 1, from: accounts[0] }));
            await expectThrow(token.buyTokens({ value: 1, from: accounts[1] }));
        });

        it('should not allow to finalize the fundraiser by a non-owner, even if the hardcap is reached', async function () {
            let ethersHardCap = Math.ceil(hardCap / initialConversionRate);
            let result = await token.send(ethersHardCap);
            await expectThrow(token.finalize({ from: accounts[1] }));
        });

        it('should not allow to transfer tokens, since it is frozen', async function () {
            let ethersHardCap = Math.ceil(hardCap / initialConversionRate);
            await token.send(ethersHardCap);
            await expectThrow(token.transfer(accounts[1], 1));
        });

        it('should not allow to transfer tokens, since it is frozen', async function () {
            let ethersHardCap = Math.ceil(hardCap / initialConversionRate);
            await token.send(ethersHardCap);
            await token.finalize();
            assert.isOk(await token.finalized.call());
            let result = await token.transfer(accounts[1], 1);
            assert.isOk(result);
        });
    });

    describe('funds receive during the fundraiser', function () {
        beforeEach(async function () {
            token = await FundraiserUT.new(accounts[0], initialConversionRate, oneDayBefore, oneDayAfter, hardCap);
            await token.whitelistAddresses([accounts[0], accounts[1], accounts[2]]);
        });

        async function assert_funds(acc, value, logs) {
            let balance = await token.balanceOf.call(acc);
            assert.equal(balance, initialConversionRate * value);
            let totalSupply = await token.totalSupply.call();
            assert.equal(totalSupply, initialConversionRate * value);
            assert.equal(logs.length, 2);
            let fundsReceivedEvent = logs.find(e => e.event === 'FundsReceived');
            assert.isOk(fundsReceivedEvent);
            fundsReceivedEvent.args._ethers.should.be.bignumber.equal(value);
            fundsReceivedEvent.args._tokens.should.be.bignumber.equal(value * initialConversionRate);
            fundsReceivedEvent.args._newTotalSupply.should.be.bignumber.equal(value * initialConversionRate);
            fundsReceivedEvent.args._conversionRate.should.be.bignumber.equal(initialConversionRate);
            let transferEvent = logs.find(e => e.event === 'Transfer');
            assert.isOk(transferEvent);
            transferEvent.args._value.should.be.bignumber.equal(value * initialConversionRate);
        }

        it('should allow to create tokens by sending ether to contract', async function () {
            let result = await token.send(10);
            let balance = await token.balanceOf.call(accounts[0]);
            await assert_funds(accounts[0], 10, result.logs);
        });

        it('should allow to create tokens by sending ether to #buyTokens()', async function () {
            let result = await token.buyTokens({ value: 10 });
            let balance = await token.balanceOf.call(accounts[0]);
            await assert_funds(accounts[0], 10, result.logs);
        });

        it('should allow anyone to buy tokens as anyone else using #buyTokens()', async function () {
            let result = await token.buyTokens({ value: 2, from: accounts[2] });
            let balance = await token.balanceOf.call(accounts[2]);
            await assert_funds(accounts[2], 2, result.logs);
        });

        it('should allow anyone to buy tokens by sending ether to contract', async function () {
            let buyer = accounts[1]; // different than the owner
            let result = await token.sendTransaction({ value: 3, from: buyer });
            await assert_funds(buyer, 3, result.logs);
        });

        it('should not allow zero ether transactions', async function () {
            await expectThrow(token.send(0));
            await expectThrow(token.sendTransaction({ value: 0, from: accounts[1] }));
            await expectThrow(token.buyTokens({ value: 0, from: accounts[0] }));
        });
    });

    describe('second before and after the end date fundraiser', function () {
        beforeEach(async function () {
            updateTimestamps();
            token = await FundraiserUT.new(accounts[0], initialConversionRate, oneDayBefore, now + 5, hardCap);
            await token.whitelistAddresses([accounts[0]]);
            updateTimestamps()
        });

        it('should only allow the owner to finalize the fundraiser', async function () {
            let lowerThenHardCapEther = Math.floor(hardCap / initialConversionRate) - 1;
            await token.send(lowerThenHardCapEther);
            advanceTime(20); // now + 20
            await expectThrow(token.finalize({ from: accounts[1] }));
            assert.isNotOk(await token.finalized.call());
            await token.finalize({ from: accounts[0] });
            assert.isOk(await token.finalized.call());
        });

        it('should allow to finalize fundraiser after end date, even if the hard cap is not reached', async function () {
            let lowerThenHardCapEther = Math.floor(hardCap / initialConversionRate) - 1;
            await token.send(lowerThenHardCapEther);
            advanceTime(20); // now + 20
            await token.finalize();
            assert.isOk(await token.finalized.call());
        });
    });

    // KLUDGE: This test requires to be after the fundraiser tests since it manipulates time.
    //         However experience shows that truffle cannot guarantee consistent order of execution
    //         of the tests suites.
    describe('integration testing the FabricTokenSafe using FundraiserUT', function () {
        let safe;
        const CORE_TEAM = 0,
            ADVISORS = 1;
        const initialConversionRate = 3000;
        const hardCap = 10 ** 5;
        const decimalsFactor = new BigNumber(10).pow(18);
        const millionFactor = new BigNumber(10).pow(6);
        const totalSupply = new BigNumber(19).mul(millionFactor).mul(decimalsFactor);

        let coreTeamAccounts = [
            ["0x9E1Ef1eC212F5DFfB41d35d9E5c14054F26c6560", new BigNumber(4).mul(millionFactor).mul(decimalsFactor)],
            ["0xce42bdB34189a93c55De250E011c68FaeE374Dd3", new BigNumber(4).mul(millionFactor).mul(decimalsFactor)],
            ["0x97A3FC5Ee46852C1Cf92A97B7BaD42F2622267cC", new BigNumber(4).mul(millionFactor).mul(decimalsFactor)],
        ];

        let advisorsAccounts = [
            ["0xB9dcBf8A52Edc0C8DD9983fCc1d97b1F5d975Ed7", new BigNumber(2).mul(millionFactor).mul(decimalsFactor)],
            ["0x26064a2E2b568D9A6D01B93D039D1da9Cf2A58CD", new BigNumber(1).mul(millionFactor).mul(decimalsFactor)],
            ["0xe84Da28128a48Dd5585d1aBB1ba67276FdD70776", new BigNumber(1).mul(millionFactor).mul(decimalsFactor)],
            ["0xCc036143C68A7A9a41558Eae739B428eCDe5EF66", new BigNumber(1).mul(millionFactor).mul(decimalsFactor)],
            ["0xE2b3204F29Ab45d5fd074Ff02aDE098FbC381D42", new BigNumber(1).mul(millionFactor).mul(decimalsFactor)],
            ["0x5D82c01e0476a0cE11C56b1711FeFf2d80CbB8B6", new BigNumber(1).mul(millionFactor).mul(decimalsFactor)],
        ];


        beforeEach(async function () {
            updateTimestamps();
            token = await FundraiserUT.new(accounts[0], initialConversionRate, oneDayBefore, now, hardCap);
            safe = FabricTokenSafe.at(await token.fabricTokenSafe.call());
            // Finalize fundraiser
            await token.finalize();
            assert.isTrue(await token.finalized.call());
        });

        it('should allow the release of advisors\' locked tokens, but not before the release date', async function () {
            let [, releaseDate] = await safe.bundles.call(ADVISORS);
            if (now > releaseDate.toNumber()) {
                assert.fail(0, 0, 'The release date for the advisors has already passed');
            }
            // Before the release date
            for (let [address,] of advisorsAccounts) {
                await expectThrow(safe.releaseAdvisorsAccount({ from: address }));
            }

            // Move after the release date
            advanceTime(releaseDate - now + 100);

            // Release all advisors' locked accounts
            for (let [address, amount] of advisorsAccounts) {
                await safe.releaseAdvisorsAccount({ from: address });
                let accountBalance = await token.balanceOf.call(address);
                accountBalance.should.be.bignumber.equal(amount);
            }

            let [lockedTokens,] = await safe.bundles.call(ADVISORS);
            lockedTokens.should.be.bignumber.equal(0);
        });

        it('should allow the release of core team locked tokens, but not before the release date', async function () {
            let [, releaseDate] = await safe.bundles.call(CORE_TEAM);
            if (now > releaseDate.toNumber()) {
                assert.fail(0, 0, 'The release date for the core team has already passed');
            }
            // Before the release date
            for (let [address,] of coreTeamAccounts) {
                await expectThrow(safe.releaseCoreTeamAccount({ from: address }));
            }

            // Move after the release date
            advanceTime(releaseDate - now + 100);

            // Release all core team locked accounts
            for (let [address, amount] of coreTeamAccounts) {
                await safe.releaseCoreTeamAccount({ from: address });
                let accountBalance = await token.balanceOf.call(address);
                accountBalance.should.be.bignumber.equal(amount);
            }

            let [lockedTokens,] = await safe.bundles.call(CORE_TEAM);
            lockedTokens.should.be.bignumber.equal(0);
        });
    });
});
