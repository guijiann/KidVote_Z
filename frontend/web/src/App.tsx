import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface VoteData {
  id: number;
  title: string;
  optionA: string;
  optionB: string;
  timestamp: number;
  creator: string;
  encryptedVotes: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface VoteStats {
  totalVotes: number;
  optionACount: number;
  optionBCount: number;
  participationRate: number;
  verifiedVotes: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votes, setVotes] = useState<VoteData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ title: "", optionA: "", optionB: "", votes: "" });
  const [selectedVote, setSelectedVote] = useState<VoteData | null>(null);
  const [decryptedCount, setDecryptedCount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState<VoteStats>({ totalVotes: 0, optionACount: 0, optionBCount: 0, participationRate: 0, verifiedVotes: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    calculateStats();
  }, [votes]);

  const calculateStats = () => {
    const total = votes.length;
    const verified = votes.filter(v => v.isVerified).length;
    const optionA = votes.reduce((sum, v) => sum + (v.publicValue1 || 0), 0);
    const optionB = votes.reduce((sum, v) => sum + (v.publicValue2 || 0), 0);
    const participation = total > 0 ? Math.round((optionA + optionB) / total * 100) : 0;
    
    setStats({
      totalVotes: total,
      optionACount: optionA,
      optionBCount: optionB,
      participationRate: participation,
      verifiedVotes: verified
    });
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votesList: VoteData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votesList.push({
            id: parseInt(businessId.replace('vote-', '')) || Date.now(),
            title: businessData.name,
            optionA: "Option A",
            optionB: "Option B",
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            encryptedVotes: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading vote data:', e);
        }
      }
      
      setVotes(votesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createVote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating vote with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const voteCount = parseInt(newVoteData.votes) || 0;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteCount);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newVoteData.votes) || 0,
        0,
        "Kids Voting Session"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewVoteData({ title: "", optionA: "", optionB: "", votes: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available!" 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredVotes = votes.filter(vote => 
    vote.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vote.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card mint">
          <h3>Total Votes</h3>
          <div className="stat-value">{stats.totalVotes}</div>
          <div className="stat-label">Active Sessions</div>
        </div>
        
        <div className="stat-card cream">
          <h3>Participation</h3>
          <div className="stat-value">{stats.participationRate}%</div>
          <div className="stat-label">Rate</div>
        </div>
        
        <div className="stat-card pink">
          <h3>Option A</h3>
          <div className="stat-value">{stats.optionACount}</div>
          <div className="stat-label">Votes</div>
        </div>
        
        <div className="stat-card blue">
          <h3>Verified</h3>
          <div className="stat-value">{stats.verifiedVotes}</div>
          <div className="stat-label">Sessions</div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Vote Encryption</h4>
            <p>Votes encrypted with FHE technology</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Secure Storage</h4>
            <p>Encrypted data stored on blockchain</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Counting</h4>
            <p>Votes counted without decryption</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Result Verification</h4>
            <p>Final results verified on-chain</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🎮 KidVote FHE</h1>
            <p>Secure Voting for Kids</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="welcome-section">
          <div className="welcome-content">
            <div className="welcome-icon">🔐</div>
            <h2>Welcome to KidVote!</h2>
            <p>Connect your wallet to start secure, encrypted voting sessions for children.</p>
            <div className="features-list">
              <div className="feature">
                <span>🎯</span>
                <p>Child-friendly interface</p>
              </div>
              <div className="feature">
                <span>🔒</span>
                <p>FHE encrypted voting</p>
              </div>
              <div className="feature">
                <span>👶</span>
                <p>No peer pressure</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Initializing FHE System...</p>
        <p className="loading-note">Getting ready for secure voting</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>Loading voting sessions...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🎮 KidVote FHE</h1>
          <p>Secure Encrypted Voting</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Vote
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>📊 Voting Statistics</h2>
          {renderStats()}
          
          <div className="fhe-info-panel">
            <h3>🔐 FHE Voting Process</h3>
            {renderFHEProcess()}
          </div>
        </div>
        
        <div className="votes-section">
          <div className="section-header">
            <h2>🗳️ Active Voting Sessions</h2>
            <div className="header-controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search votes..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄" : "↻"}
              </button>
            </div>
          </div>
          
          <div className="votes-grid">
            {filteredVotes.length === 0 ? (
              <div className="no-votes">
                <p>No voting sessions found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Vote
                </button>
              </div>
            ) : filteredVotes.map((vote, index) => (
              <div 
                className={`vote-card ${selectedVote?.id === vote.id ? "selected" : ""} ${vote.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedVote(vote)}
              >
                <div className="vote-title">{vote.title}</div>
                <div className="vote-options">
                  <span>Option A: {vote.publicValue1}</span>
                  <span>Option B: {vote.publicValue2}</span>
                </div>
                <div className="vote-meta">
                  <span>Created: {new Date(vote.timestamp * 1000).toLocaleDateString()}</span>
                  <span className={`status ${vote.isVerified ? "verified" : "pending"}`}>
                    {vote.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
                <div className="vote-creator">By: {vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateVoteModal 
          onSubmit={createVote} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingVote} 
          voteData={newVoteData} 
          setVoteData={setNewVoteData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedVote && (
        <VoteDetailModal 
          vote={selectedVote} 
          onClose={() => { 
            setSelectedVote(null); 
            setDecryptedCount(null); 
          }} 
          decryptedCount={decryptedCount} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedVote.encryptedVotes)}
          stats={stats}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="notification-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>🔐 KidVote FHE - Secure encrypted voting for children</p>
          <div className="footer-links">
            <span>Privacy Protected</span>
            <span>•</span>
            <span>FHE Encrypted</span>
            <span>•</span>
            <span>Child Safe</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const CreateVoteModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  voteData: any;
  setVoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, voteData, setVoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'votes') {
      const intValue = value.replace(/[^\d]/g, '');
      setVoteData({ ...voteData, [name]: intValue });
    } else {
      setVoteData({ ...voteData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Vote</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>🔐 FHE Encryption Active</strong>
            <p>Vote counts will be encrypted with fully homomorphic encryption</p>
          </div>
          
          <div className="form-group">
            <label>Vote Title *</label>
            <input 
              type="text" 
              name="title" 
              value={voteData.title} 
              onChange={handleChange} 
              placeholder="What are we voting on?" 
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Option A *</label>
              <input 
                type="text" 
                name="optionA" 
                value={voteData.optionA} 
                onChange={handleChange} 
                placeholder="First choice" 
              />
            </div>
            <div className="form-group">
              <label>Option B *</label>
              <input 
                type="text" 
                name="optionB" 
                value={voteData.optionB} 
                onChange={handleChange} 
                placeholder="Second choice" 
              />
            </div>
          </div>
          
          <div className="form-group">
            <label>Initial Vote Count (Integer) *</label>
            <input 
              type="number" 
              name="votes" 
              value={voteData.votes} 
              onChange={handleChange} 
              placeholder="Starting vote count" 
              step="1"
              min="0"
            />
            <div className="input-note">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !voteData.title || !voteData.votes} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: VoteData;
  onClose: () => void;
  decryptedCount: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  stats: VoteStats;
}> = ({ vote, onClose, decryptedCount, isDecrypting, decryptData, stats }) => {
  const handleDecrypt = async () => {
    if (decryptedCount !== null) return;
    await decryptData();
  };

  const renderVoteChart = () => {
    const total = vote.publicValue1 + vote.publicValue2;
    const optionAPercent = total > 0 ? (vote.publicValue1 / total) * 100 : 0;
    const optionBPercent = total > 0 ? (vote.publicValue2 / total) * 100 : 0;

    return (
      <div className="vote-chart">
        <div className="chart-title">Vote Distribution</div>
        <div className="chart-bars">
          <div className="chart-bar">
            <div className="bar-label">Option A</div>
            <div className="bar-container">
              <div 
                className="bar-fill option-a" 
                style={{ width: `${optionAPercent}%` }}
              >
                <span className="bar-value">{vote.publicValue1}</span>
              </div>
            </div>
            <div className="bar-percent">{optionAPercent.toFixed(1)}%</div>
          </div>
          <div className="chart-bar">
            <div className="bar-label">Option B</div>
            <div className="bar-container">
              <div 
                className="bar-fill option-b" 
                style={{ width: `${optionBPercent}%` }}
              >
                <span className="bar-value">{vote.publicValue2}</span>
              </div>
            </div>
            <div className="bar-percent">{optionBPercent.toFixed(1)}%</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Vote Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{vote.title}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(vote.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>🔐 Encrypted Vote Data</h3>
            
            <div className="data-row">
              <div className="data-label">Total Votes:</div>
              <div className="data-value">
                {vote.isVerified && vote.decryptedValue ? 
                  `${vote.decryptedValue} (Verified)` : 
                  decryptedCount !== null ? 
                  `${decryptedCount} (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(vote.isVerified || decryptedCount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || vote.isVerified}
              >
                {isDecrypting ? "Decrypting..." : 
                 vote.isVerified ? "✅ Verified" : 
                 decryptedCount !== null ? "🔓 Decrypted" : 
                 "🔓 Decrypt"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <p>Votes are encrypted using FHE technology. Decryption happens offline and is verified on-chain.</p>
            </div>
          </div>
          
          {renderVoteChart()}
          
          <div className="vote-results">
            <div className="result-item">
              <span>Option A Votes:</span>
              <strong>{vote.publicValue1}</strong>
            </div>
            <div className="result-item">
              <span>Option B Votes:</span>
              <strong>{vote.publicValue2}</strong>
            </div>
            <div className="result-item">
              <span>Total Votes:</span>
              <strong>{vote.publicValue1 + vote.publicValue2}</strong>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!vote.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;