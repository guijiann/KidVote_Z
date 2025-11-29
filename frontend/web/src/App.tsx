import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VoteData {
  id: string;
  title: string;
  option1: string;
  option2: string;
  option3: string;
  encryptedCount: number;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votes, setVotes] = useState<VoteData[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ 
    title: "", 
    option1: "", 
    option2: "", 
    option3: "" 
  });
  const [selectedVote, setSelectedVote] = useState<VoteData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("votes");
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
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
        await loadVotes();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('加载数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadVotes = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votesList: VoteData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votesList.push({
            id: businessId,
            title: businessData.name,
            option1: "选项A",
            option2: "选项B", 
            option3: "选项C",
            encryptedCount: 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('加载投票数据错误:', e);
        }
      }
      
      setVotes(votesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const createVote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "创建加密投票中..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const voteValue = 1;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        `投票选项: ${newVoteData.option1}, ${newVoteData.option2}, ${newVoteData.option3}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "投票创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadVotes();
      setShowCreateModal(false);
      setNewVoteData({ title: "", option1: "", option2: "", option3: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消了交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
    }
  };

  const decryptVote = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadVotes();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadVotes();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "合约可用性检查成功!" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
      }
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "可用性检查失败" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredVotes = votes.filter(vote => 
    vote.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vote.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    totalVotes: votes.length,
    verifiedVotes: votes.filter(v => v.isVerified).length,
    todayVotes: votes.filter(v => 
      new Date(v.timestamp * 1000).toDateString() === new Date().toDateString()
    ).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🎮 兒童隱私投票</h1>
            <p>FHE加密保護的兒童投票系統</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>連接錢包開始投票</h2>
            <p>請連接您的錢包來使用FHE加密的兒童隱私投票系統</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>點擊上方按鈕連接錢包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系統將自動初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>開始創建和參與加密投票</p>
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
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系統...</p>
        <p className="loading-note">請稍候片刻</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加載加密投票系統...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🎮 兒童隱私投票</h1>
          <p>FHE全同態加密保護 | 無壓力投票體驗</p>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            🔍 檢查合約
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            ✨ 創建投票
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <nav className="app-nav">
        <button 
          className={`nav-btn ${activeTab === "votes" ? "active" : ""}`}
          onClick={() => setActiveTab("votes")}
        >
          🗳️ 投票列表
        </button>
        <button 
          className={`nav-btn ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          📊 數據統計
        </button>
        <button 
          className={`nav-btn ${activeTab === "about" ? "active" : ""}`}
          onClick={() => setActiveTab("about")}
        >
          ℹ️ 項目介紹
        </button>
        <button 
          className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          ❓ 常見問題
        </button>
      </nav>
      
      <main className="main-content">
        {activeTab === "votes" && (
          <div className="votes-section">
            <div className="section-header">
              <h2>🗳️ 當前投票活動</h2>
              <div className="search-bar">
                <input 
                  type="text" 
                  placeholder="🔍 搜索投票標題或創建者..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            
            <div className="votes-grid">
              {filteredVotes.length === 0 ? (
                <div className="no-votes">
                  <p>暫無投票活動</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    創建第一個投票
                  </button>
                </div>
              ) : filteredVotes.map((vote, index) => (
                <div 
                  className={`vote-card ${vote.isVerified ? "verified" : ""}`}
                  key={index}
                  onClick={() => setSelectedVote(vote)}
                >
                  <div className="card-header">
                    <h3>{vote.title}</h3>
                    <span className={`status ${vote.isVerified ? "verified" : "pending"}`}>
                      {vote.isVerified ? "✅ 已驗證" : "🔒 待驗證"}
                    </span>
                  </div>
                  <div className="card-content">
                    <div className="vote-options">
                      <span>A: {vote.option1}</span>
                      <span>B: {vote.option2}</span>
                      <span>C: {vote.option3}</span>
                    </div>
                    <div className="vote-meta">
                      <span>創建者: {vote.creator.substring(0, 6)}...</span>
                      <span>時間: {new Date(vote.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="card-footer">
                    <button className="view-btn">查看詳情</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <h2>📊 投票數據統計</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">📈</div>
                <div className="stat-content">
                  <h3>總投票數</h3>
                  <div className="stat-value">{stats.totalVotes}</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">✅</div>
                <div className="stat-content">
                  <h3>已驗證投票</h3>
                  <div className="stat-value">{stats.verifiedVotes}</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">📅</div>
                <div className="stat-content">
                  <h3>今日新增</h3>
                  <div className="stat-value">{stats.todayVotes}</div>
                </div>
              </div>
            </div>
            
            <div className="chart-section">
              <h3>📈 驗證狀態分佈</h3>
              <div className="chart">
                <div className="chart-bar verified" style={{ width: `${(stats.verifiedVotes / Math.max(stats.totalVotes, 1)) * 100}%` }}>
                  <span>已驗證: {stats.verifiedVotes}</span>
                </div>
                <div className="chart-bar pending" style={{ width: `${((stats.totalVotes - stats.verifiedVotes) / Math.max(stats.totalVotes, 1)) * 100}%` }}>
                  <span>待驗證: {stats.totalVotes - stats.verifiedVotes}</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "about" && (
          <div className="about-section">
            <h2>ℹ️ 項目介紹</h2>
            <div className="about-content">
              <div className="info-card">
                <h3>🎯 項目願景</h3>
                <p>為兒童提供安全、隱私的投票環境，使用FHE全同態加密技術保護投票數據，避免同伴壓力影響。</p>
              </div>
              <div className="info-card">
                <h3>🔐 技術特色</h3>
                <ul>
                  <li>• 全同態加密保護投票隱私</li>
                  <li>• 鏈上數據驗證確保公正性</li>
                  <li>• 兒童友好的用戶界面設計</li>
                  <li>• 實時數據統計和分析</li>
                </ul>
              </div>
              <div className="info-card">
                <h3>🛡️ 隱私保護</h3>
                <p>所有投票數據在加密狀態下進行計算，只有最終結果會被解密，確保投票過程的完全隱私。</p>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-section">
            <h2>❓ 常見問題解答</h2>
            <div className="faq-list">
              <div className="faq-item">
                <h3>什麼是FHE加密？</h3>
                <p>全同態加密允許在加密數據上直接進行計算，無需解密，極大保護數據隱私。</p>
              </div>
              <div className="faq-item">
                <h3>投票數據如何保護？</h3>
                <p>所有投票選擇在本地加密後上鏈，只有最終統計結果可被授權解密。</p>
              </div>
              <div className="faq-item">
                <h3>兒童如何使用？</h3>
                <p>通過簡單的圖形界面，兒童可以輕鬆參與投票，無需理解複雜的加密技術。</p>
              </div>
            </div>
          </div>
        )}
      </main>
      
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
          onClose={() => setSelectedVote(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptVote={() => decryptVote(selectedVote.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
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
    setVoteData({ ...voteData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-vote-modal">
        <div className="modal-header">
          <h2>✨ 創建新投票</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>🔐 FHE加密保護</strong>
            <p>投票數據將使用Zama FHE進行加密保護</p>
          </div>
          
          <div className="form-group">
            <label>投票標題 *</label>
            <input 
              type="text" 
              name="title" 
              value={voteData.title} 
              onChange={handleChange} 
              placeholder="輸入投票標題..." 
            />
          </div>
          
          <div className="form-group">
            <label>選項A *</label>
            <input 
              type="text" 
              name="option1" 
              value={voteData.option1} 
              onChange={handleChange} 
              placeholder="第一個選項..." 
            />
          </div>
          
          <div className="form-group">
            <label>選項B *</label>
            <input 
              type="text" 
              name="option2" 
              value={voteData.option2} 
              onChange={handleChange} 
              placeholder="第二個選項..." 
            />
          </div>
          
          <div className="form-group">
            <label>選項C *</label>
            <input 
              type="text" 
              name="option3" 
              value={voteData.option3} 
              onChange={handleChange} 
              placeholder="第三個選項..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !voteData.title || !voteData.option1} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密創建中..." : "創建投票"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: VoteData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptVote: () => Promise<number | null>;
}> = ({ vote, onClose, isDecrypting, decryptVote }) => {
  const handleDecrypt = async () => {
    await decryptVote();
  };

  return (
    <div className="modal-overlay">
      <div className="vote-detail-modal">
        <div className="modal-header">
          <h2>🗳️ 投票詳情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <div className="info-item">
              <span>標題:</span>
              <strong>{vote.title}</strong>
            </div>
            <div className="info-item">
              <span>創建者:</span>
              <strong>{vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>創建時間:</span>
              <strong>{new Date(vote.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="vote-options-detailed">
            <h3>投票選項</h3>
            <div className="options-list">
              <div className="option-item">A: {vote.option1}</div>
              <div className="option-item">B: {vote.option2}</div>
              <div className="option-item">C: {vote.option3}</div>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>🔐 加密狀態</h3>
            <div className="encryption-status">
              <div className="status-item">
                <span>數據狀態:</span>
                <strong>{vote.isVerified ? "✅ 已驗證" : "🔒 加密中"}</strong>
              </div>
              {vote.isVerified && vote.decryptedValue && (
                <div className="status-item">
                  <span>解密結果:</span>
                  <strong>{vote.decryptedValue}</strong>
                </div>
              )}
            </div>
            
            <button 
              className={`decrypt-btn ${vote.isVerified ? 'decrypted' : ''}`}
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? "🔓 驗證中..." : vote.isVerified ? "✅ 已驗證" : "🔓 驗證解密"}
            </button>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">關閉</button>
        </div>
      </div>
    </div>
  );
};

export default App;