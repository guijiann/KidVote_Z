pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract KidVote_Z is ZamaEthereumConfig {
    struct VoteData {
        string voteId;
        euint32 encryptedVote;
        string description;
        address creator;
        uint256 timestamp;
        uint32 decryptedVote;
        bool isVerified;
    }

    mapping(string => VoteData) public voteData;
    string[] public voteIds;

    event VoteCreated(string indexed voteId, address indexed creator);
    event VoteDecrypted(string indexed voteId, uint32 decryptedVote);

    constructor() ZamaEthereumConfig() {
    }

    function createVote(
        string calldata voteId,
        externalEuint32 encryptedVote,
        bytes calldata inputProof,
        string calldata description
    ) external {
        require(bytes(voteData[voteId].voteId).length == 0, "Vote already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedVote, inputProof)), "Invalid encrypted input");

        voteData[voteId] = VoteData({
            voteId: voteId,
            encryptedVote: FHE.fromExternal(encryptedVote, inputProof),
            description: description,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedVote: 0,
            isVerified: false
        });

        FHE.allowThis(voteData[voteId].encryptedVote);
        FHE.makePubliclyDecryptable(voteData[voteId].encryptedVote);

        voteIds.push(voteId);
        emit VoteCreated(voteId, msg.sender);
    }

    function verifyVoteDecryption(
        string calldata voteId,
        bytes memory abiEncodedClearVote,
        bytes memory decryptionProof
    ) external {
        require(bytes(voteData[voteId].voteId).length > 0, "Vote does not exist");
        require(!voteData[voteId].isVerified, "Vote already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(voteData[voteId].encryptedVote);

        FHE.checkSignatures(cts, abiEncodedClearVote, decryptionProof);

        uint32 decodedVote = abi.decode(abiEncodedClearVote, (uint32));
        voteData[voteId].decryptedVote = decodedVote;
        voteData[voteId].isVerified = true;

        emit VoteDecrypted(voteId, decodedVote);
    }

    function getEncryptedVote(string calldata voteId) external view returns (euint32) {
        require(bytes(voteData[voteId].voteId).length > 0, "Vote does not exist");
        return voteData[voteId].encryptedVote;
    }

    function getVoteData(string calldata voteId) external view returns (
        string memory description,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedVote
    ) {
        require(bytes(voteData[voteId].voteId).length > 0, "Vote does not exist");
        VoteData storage data = voteData[voteId];

        return (
            data.description,
            data.creator,
            data.timestamp,
            data.isVerified,
            data.decryptedVote
        );
    }

    function getAllVoteIds() external view returns (string[] memory) {
        return voteIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


