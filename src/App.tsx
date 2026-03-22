import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, Sword, Zap, Scroll, Dices, User, Map as MapIcon, 
  RefreshCw, ChevronRight, Volume2, VolumeX, 
  Info, HelpCircle, Loader2, PlayCircle, X, Sparkles, Trophy,
  Ghost, Search, Flame, FastForward, Music, Package, Trash2
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

// --- CONFIGURAÇÕES DE API ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const GENRES = [
  {
    id: 'mystery',
    title: 'Investigação Vitoriana',
    description: 'Enigmas sob a névoa de Londres.',
    icon: <Search className="text-blue-400" size={32} />,
    color: 'from-blue-950',
    prompt: 'Mistério vitoriano estilo Sherlock Holmes. Tom analítico, elegante e misterioso.'
  },
  {
    id: 'horror',
    title: 'Terror Lovecraftiano',
    description: 'O abismo observa de volta.',
    icon: <Ghost className="text-purple-500" size={32} />,
    color: 'from-purple-950',
    prompt: 'Terror cósmico. Tom cavernoso, sussurrado, visceral e aterrorizante.'
  },
  {
    id: 'fantasy',
    title: 'Alta Fantasia Épica',
    description: 'Sangue, aço e feitiçaria.',
    icon: <Flame className="text-orange-500" size={32} />,
    color: 'from-orange-950',
    prompt: 'Alta fantasia épica. Tom heróico, vibrante, imponente e grandioso.'
  }
];

const SYSTEM_PROMPT_TEMPLATE = (genrePrompt: string) => `
Você é o Mestre Supremo de um ${genrePrompt}.
Responda APENAS em Português do Brasil.
Responda APENAS em JSON estruturado. 

DIRETRIZES DE NARRATIVA:
1. CONEXÃO: A narração deve reagir diretamente às escolhas e ao estado emocional do personagem.
2. EMOÇÃO: Use palavras sensoriais, pausas dramáticas (indicadas por ...) e variações de ritmo.
3. COMBATE: Se houver um confronto, descreva a ação de forma visceral. Use o sistema de HP se necessário.
4. IMERSÃO: Descreva não apenas o que acontece, mas o que o personagem SENTE e OUVE.

ESTRUTURA JSON:
{
  "title": "Título Impactante",
  "narration": "Narrativa visceral e emocionante (2 parágrafos). Use '...' para pausas dramáticas.",
  "options": [{ "text": "Ação", "attribute": "atributo", "dc": 10, "diceType": "D4 | D6 | D8 | D10 | D12 | D20", "isCombat": false }],
  "acquiredItems": [{ "name": "Nome do Item", "description": "Descrição", "icon": "Sword | Shield | Potion | Key | Scroll", "effect": "+5 Força", "rarity": "comum | raro | épico | lendário" }],
  "combat": { "enemyName": "Nome", "enemyHp": 50, "enemyHpChange": -10, "playerHpChange": 0 },
  "visualPrompt": "Cinematic art style of [subject]...",
  "shortSubtitle": "Legenda rápida e impactante"
}

PARA SUGESTÕES:
{
  "archetypes": [
    { "name": "Nome", "class": "Classe", "stats": { "força": 10, "agilidade": 10, "inteligência": 10, "carisma": 10 }, "bio": "Bio curta", "visualPrompt": "Prompt visual" }
  ]
}
`;

// Helper: Conversão PCM para WAV (24kHz)
function pcmToWav(pcmData: Uint8Array, sampleRate = 24000) {
  const buffer = new ArrayBuffer(44 + pcmData.length);
  const view = new DataView(buffer);
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcmData.length, true);
  for (let i = 0; i < pcmData.length; i++) view.setUint8(44 + i, pcmData[i]);
  return new Blob([buffer], { type: 'audio/wav' });
}

export default function App() {
  const [step, setStep] = useState('landing'); 
  const [genre, setGenre] = useState<any>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [character, setCharacter] = useState<any>(null);
  const [scene, setScene] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [diceResult, setDiceResult] = useState<any>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [rollingValue, setRollingValue] = useState(1);
  const [pendingAction, setPendingAction] = useState<any>(null);
  
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [useNativeTTS, setUseNativeTTS] = useState(false);
  const [activeSubtitle, setActiveSubtitle] = useState("");
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const [newItemsToast, setNewItemsToast] = useState<any[]>([]);
  const [showDamageFlash, setShowDamageFlash] = useState(false);
  const [showEnemyHitFlash, setShowEnemyHitFlash] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);

  const callGemini = async (prompt: string) => {
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE(genre?.prompt || "RPG épico");
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json"
      }
    });
    
    let text = response.text || "{}";
    // Remove markdown code blocks if the model accidentally includes them
    text = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    
    // Tenta encontrar o último '}' caso o modelo tenha cuspido lixo depois
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace < text.length - 1) {
      text = text.substring(0, lastBrace + 1);
    }
    
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("Erro ao fazer parse do JSON:", text);
      // Fallback: tenta limpar caracteres não-JSON comuns
      try {
        const cleaned = text.replace(/[^\x20-\x7E]/g, '');
        return JSON.parse(cleaned);
      } catch (innerE) {
        return {};
      }
    }
  };

  const generateTTS = async (text: string) => {
    if (!isAudioEnabled) return;
    setIsTalking(true);
    
    // Cancela qualquer narração anterior
    window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    const speakNative = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 0.95;
      utterance.onend = () => setIsTalking(false);
      window.speechSynthesis.speak(utterance);
    };

    // Se já sabemos que a cota estourou, usa nativo direto
    if (useNativeTTS) {
      speakNative();
      return;
    }
    
    // Timer para fallback rápido se a API demorar demais
    const fallbackTimeout = setTimeout(() => {
      if (isTalking && !window.speechSynthesis.speaking) {
        console.log("TTS API demorou demais, usando fallback nativo...");
        speakNative();
      }
    }, 3500);

    try {
      const voice = genre?.id === 'horror' ? "Charon" : (genre?.id === 'mystery' ? "Puck" : "Zephyr");
      const mood = genre?.id === 'horror' ? "sombrio e aterrorizante" : (genre?.id === 'mystery' ? "misterioso e elegante" : "heróico e épico");
      
      const ttsPromise = ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: `Diga em Português do Brasil com voz de mestre de RPG, tom ${mood} e muita emoção, respeitando as pausas: ${text}`,
        config: { 
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } 
        }
      });

      const response = await ttsPromise;
      clearTimeout(fallbackTimeout);
      
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      
      if (!base64Audio) {
        throw new Error("Sem dados de áudio na resposta");
      }
      
      const binaryAudio = atob(base64Audio);
      const uint8Array = new Uint8Array(binaryAudio.length);
      for (let i = 0; i < binaryAudio.length; i++) uint8Array[i] = binaryAudio.charCodeAt(i);
      
      const wavBlob = pcmToWav(uint8Array);
      if (audioRef.current) {
        window.speechSynthesis.cancel();
        audioRef.current.src = URL.createObjectURL(wavBlob);
        audioRef.current.play().catch((err) => {
          console.error("Erro ao dar play no áudio:", err);
          speakNative();
        });
      }
    } catch (e: any) { 
      // Silencia erros de cota no console para o usuário e ativa fallback
      const isQuotaError = 
        e?.message?.includes('429') || 
        e?.status === 'RESOURCE_EXHAUSTED' || 
        JSON.stringify(e)?.includes('429') ||
        JSON.stringify(e)?.includes('RESOURCE_EXHAUSTED');

      if (isQuotaError) {
        console.warn("Cota de TTS atingida. Mudando para narração nativa.");
        setUseNativeTTS(true);
      } else {
        console.error("Erro TTS API:", e);
      }

      clearTimeout(fallbackTimeout);
      
      if (!window.speechSynthesis.speaking) {
        speakNative();
      }
    }
  };

  const generateImage = async (prompt: string, aspectRatio: "1:1" | "16:9" = "1:1") => {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: prompt }] },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio,
            imageSize: "1K"
          }
        },
      });
      
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64EncodeString: string = part.inlineData.data;
          return `data:image/png;base64,${base64EncodeString}`;
        }
      }
      return null;
    } catch (e: any) { 
      const isQuotaError = 
        e?.message?.includes('429') || 
        e?.status === 'RESOURCE_EXHAUSTED' || 
        JSON.stringify(e)?.includes('429') ||
        JSON.stringify(e)?.includes('RESOURCE_EXHAUSTED');

      if (isQuotaError) {
        console.warn("Cota de Imagem atingida. Usando placeholder.");
        return `https://picsum.photos/seed/${encodeURIComponent(prompt.substring(0, 20))}/1024/1024`;
      }
      console.error("Erro Imagem:", e);
      return null; 
    }
  };

  const requestSuggestions = async (selectedGenre: any) => {
    setGenre(selectedGenre);
    setIsLoading(true);
    setStep('suggesting');
    try {
      const data = await callGemini(`Gere 3 personagens épicos para o gênero ${selectedGenre.title}.`);
      setSuggestions(data.archetypes || []);
      setIsLoading(false);
    } catch (e) { 
      console.error(e);
      setStep('landing'); 
      setIsLoading(false); 
    }
  };

  const selectCharacter = async (arch: any) => {
    setIsLoading(true);
    setStep('creating');
    setCharacter({ ...arch, hp: 100, maxHp: 100, inventory: [] });
    
    // Desbloqueia contexto de áudio
    if (audioRef.current) {
        audioRef.current.play().then(() => audioRef.current.pause()).catch(() => {});
    }

    loadScene(`O herói ${arch.name} inicia sua jornada em ${genre.title}. Prólogo impactante.`);
    
    generateImage(arch.visualPrompt, '1:1').then(img => {
      if(img) setCharacter((prev: any) => ({ ...prev, image: img }));
    });
  };

  const loadScene = async (prompt: string) => {
    setIsLoading(true);
    try {
      const sceneData = await callGemini(prompt);
      setScene((prev: any) => ({ ...sceneData, image: prev?.image }));
      setStep('playing');
      setIsLoading(false);

      // Efeito de dano se o player perder HP
      if (sceneData.combat?.playerHpChange < 0) {
        setShowDamageFlash(true);
        setTimeout(() => setShowDamageFlash(false), 500);
        
        setCharacter((prev: any) => ({
          ...prev,
          hp: Math.max(0, (prev.hp || 100) + sceneData.combat.playerHpChange)
        }));
      } else if (sceneData.combat?.enemyHpChange < 0) {
        // Efeito visual de acerto no inimigo
        setShowEnemyHitFlash(true);
        setTimeout(() => setShowEnemyHitFlash(false), 500);
      }

      // Gerencia itens adquiridos
      if (sceneData.acquiredItems && sceneData.acquiredItems.length > 0) {
        setCharacter((prev: any) => ({
          ...prev,
          inventory: [...(prev.inventory || []), ...sceneData.acquiredItems]
        }));
        setNewItemsToast(sceneData.acquiredItems);
        setTimeout(() => setNewItemsToast([]), 5000);
      }
      
      // Inicia Narração
      if (isAudioEnabled) {
        setActiveSubtitle(sceneData.shortSubtitle || sceneData.title);
        generateTTS(sceneData.narration);
      }
      
      setIsImageLoading(true);
      generateImage(sceneData.visualPrompt, '16:9').then(img => {
        if (img) setScene((prev: any) => ({ ...prev, image: img }));
        setIsImageLoading(false);
      });
      
    } catch (e) { 
      console.error(e);
      setIsLoading(false); 
    }
  };

  const renderItemIcon = (iconName: string, rarity?: string) => {
    const getRarityColor = () => {
      switch (rarity?.toLowerCase()) {
        case 'raro': return 'text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]';
        case 'épico': return 'text-purple-400 drop-shadow-[0_0_10px_rgba(192,132,252,0.8)]';
        case 'lendário': return 'text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,1)] animate-pulse';
        default: return 'text-amber-500';
      }
    };

    const iconClass = getRarityColor();

    switch (iconName?.toLowerCase()) {
      case 'sword': return <Sword size={20} className={iconClass} />;
      case 'shield': return <Shield size={20} className={iconClass} />;
      case 'potion': return <Zap size={20} className={iconClass} />;
      case 'key': return <Search size={20} className={iconClass} />;
      case 'scroll': return <Scroll size={20} className={iconClass} />;
      default: return <Package size={20} className={iconClass} />;
    }
  };

  const renderDiceVisual = (type: string, value: number, isRolling: boolean) => {
    const diceType = type?.toUpperCase() || 'D20';
    const sides = parseInt(diceType.replace('D', '')) || 20;
    
    // Simple visual mapping for different dice shapes
    const getDiceShape = () => {
      switch (diceType) {
        case 'D4': return '[clip-path:polygon(50%_0%,0%_100%,100%_100%)]'; // Triangle
        case 'D6': return 'rounded-2xl'; // Square
        case 'D8': return '[clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)]'; // Diamond
        case 'D10': return '[clip-path:polygon(50%_0%,100%_35%,80%_100%,20%_100%,0%_35%)]'; // Pentagonal
        case 'D12': return '[clip-path:polygon(30%_0%,70%_0%,100%_30%,100%_70%,70%_100%,30%_100%,0%_70%,0%_30%)]'; // Octagonal
        default: return 'rounded-[2.5rem]'; // D20/Default
      }
    };

    return (
      <div className={`relative w-48 h-48 flex items-center justify-center transition-all duration-300 ${isRolling ? 'animate-bounce scale-110' : ''}`}>
        <div className={`absolute inset-0 bg-slate-900 border-4 border-amber-500/50 shadow-2xl ${getDiceShape()} ${isRolling ? 'animate-spin' : ''}`}></div>
        <div className="relative z-10 text-7xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">
          {value}
        </div>
        <div className="absolute -bottom-8 text-amber-500/60 font-black text-sm tracking-[0.4em] uppercase">
          {diceType}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#020202] text-slate-100 font-serif flex flex-col overflow-hidden">
      <audio 
        ref={audioRef} 
        onPlay={() => setIsTalking(true)}
        onEnded={() => { setIsTalking(false); setActiveSubtitle(""); }} 
      />

      {/* Efeito de Dano (Flash Vermelho) */}
      {showDamageFlash && (
        <div className="fixed inset-0 z-[1000] bg-red-600/30 pointer-events-none animate-in fade-in duration-75 fade-out" />
      )}

      {/* Efeito de Acerto no Inimigo (Flash Branco) */}
      {showEnemyHitFlash && (
        <div className="fixed inset-0 z-[1000] bg-white/20 pointer-events-none animate-in fade-in duration-75 fade-out" />
      )}

      {/* Landing Page */}
      {step === 'landing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-12 bg-black">
          <div className="relative animate-in zoom-in duration-1000">
            <h1 className="text-8xl font-black text-white italic tracking-tighter">NEXUS</h1>
            <div className="absolute inset-0 blur-3xl bg-amber-500/10 rounded-full"></div>
            <p className="text-amber-500 uppercase tracking-[0.6em] text-xs font-bold opacity-80 mt-2">O Oráculo Narrado</p>
          </div>
          <button 
            onClick={() => {
                // Interação necessária para desbloquear áudio no browser
                if (audioRef.current) audioRef.current.play().catch(() => {});
                setStep('selecting_genre');
            }} 
            className="px-16 py-6 bg-amber-600 text-black font-black text-2xl rounded-full hover:scale-110 transition-all shadow-2xl active:scale-95 cursor-pointer"
          >
            DESPERTAR
          </button>
        </div>
      )}

      {/* Seleção de Gênero */}
      {step === 'selecting_genre' && (
        <div className="flex-1 flex flex-col p-8 space-y-10 bg-black overflow-y-auto">
          <div className="text-center">
            <h2 className="text-4xl font-black italic">Escolha sua Realidade</h2>
            <p className="text-slate-500 text-xs uppercase tracking-widest mt-2">O áudio será ativado automaticamente.</p>
          </div>
          <div className="grid gap-6 max-w-xl mx-auto w-full">
            {GENRES.map((g) => (
              <button key={g.id} onClick={() => requestSuggestions(g)} className={`p-8 bg-gradient-to-br ${g.color} to-black/80 border border-white/10 rounded-[2.5rem] text-left hover:border-amber-500 transition-all active:scale-95 group cursor-pointer`}>
                <div className="flex gap-6 items-center">
                  <div className="p-4 bg-black/40 rounded-2xl group-hover:scale-110 transition-transform">{g.icon}</div>
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-1">{g.title}</h3>
                    <p className="text-sm text-slate-400 font-light">{g.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sugestões de Personagem */}
      {step === 'suggesting' && (
        <div className="flex-1 flex flex-col p-8 space-y-8 bg-black overflow-y-auto">
          <div className="text-center">
             <h2 className="text-4xl font-black italic">Invoque seu Avatar</h2>
          </div>
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4">
               <Loader2 className="animate-spin text-amber-500" size={48} />
               <p className="text-amber-500 uppercase text-[10px] tracking-widest">Tecendo Almas...</p>
            </div>
          ) : (
            <div className="grid gap-6 max-w-xl mx-auto w-full">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => selectCharacter(s)} className="p-6 bg-slate-900/40 border border-white/5 rounded-3xl text-left hover:border-amber-500 transition-all active:scale-95 cursor-pointer">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-2xl font-bold text-white">{s.name}</h3>
                    <span className="text-[10px] font-bold uppercase bg-amber-600/20 text-amber-500 px-3 py-1 rounded-full">{s.class}</span>
                  </div>
                  <p className="text-sm text-slate-300 italic mb-4">"{s.bio}"</p>
                  <div className="flex gap-4 opacity-50 text-[10px] font-bold uppercase">
                    {Object.entries(s.stats || {}).map(([stat, val]) => (
                      <span key={stat}>{stat.slice(0,3)}: {String(val)}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Jogo Principal */}
      {(step === 'playing' || step === 'creating') && (
        <>
          <header className="p-4 border-b border-white/5 bg-black/95 flex justify-between items-center z-50">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl border-2 border-amber-600 overflow-hidden bg-slate-900 shadow-lg relative">
                {character?.image && <img src={character?.image} className="w-full h-full object-cover" alt="Character" />}
                {isTalking && (
                    <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                        <Volume2 className="text-amber-500 animate-pulse" size={24} />
                    </div>
                )}
              </div>
              <div className="leading-none">
                <div className="text-lg font-black text-white italic">{character?.name}</div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                    <div 
                      className="h-full bg-green-500 transition-all duration-500" 
                      style={{ width: `${(character?.hp || 100) / (character?.maxHp || 100) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-[8px] font-bold text-slate-400">{character?.hp || 100} HP</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsInventoryOpen(true)}
                className="p-3 rounded-xl bg-slate-900 text-amber-500 hover:bg-slate-800 transition-all cursor-pointer relative"
              >
                <Package size={20} />
                {character?.inventory?.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-600 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                    {character.inventory.length}
                  </span>
                )}
              </button>
              <button onClick={() => {
                  setIsAudioEnabled(!isAudioEnabled);
                  if (audioRef.current) audioRef.current.pause();
                  window.speechSynthesis.cancel();
                }} 
                className={`p-3 rounded-xl transition-all cursor-pointer ${isAudioEnabled ? 'bg-amber-600 text-black shadow-lg shadow-amber-500/20' : 'bg-slate-900 text-slate-500'}`}
              >
                {isAudioEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </button>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto pb-48">
            <div className="relative aspect-video w-full overflow-hidden shadow-2xl bg-slate-900">
               {(scene?.image || character?.image) && (
                 <img src={scene?.image || character?.image} className={`w-full h-full object-cover transition-opacity duration-1000 ${isImageLoading ? 'opacity-40 scale-105' : 'opacity-100'} ${showEnemyHitFlash ? 'animate-shake' : ''}`} alt="Scene" />
               )}
               <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent"></div>
               
               {/* Status do Inimigo em Combate */}
               {scene?.combat && (
                 <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md px-6 py-3 rounded-2xl border border-red-500/30 flex flex-col items-center gap-2 animate-in slide-in-from-top-4">
                    <div className="text-[10px] font-black text-red-500 uppercase tracking-[0.3em] flex items-center gap-2">
                      <Flame size={12} /> EM COMBATE <Flame size={12} />
                    </div>
                    <div className="text-sm font-bold text-white italic">{scene.combat.enemyName}</div>
                    <div className="w-32 h-2 bg-slate-900 rounded-full overflow-hidden border border-white/5">
                      <div 
                        className="h-full bg-red-600 transition-all duration-500" 
                        style={{ width: `${Math.max(0, scene.combat.enemyHp)}%` }}
                      ></div>
                    </div>
                 </div>
               )}

               {isImageLoading && (
                 <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="animate-spin text-amber-500/50" size={32} />
                 </div>
               )}

               {activeSubtitle && (
                 <div className="absolute bottom-6 left-8 right-8 bg-black/90 backdrop-blur-lg p-5 rounded-2xl border border-white/10 text-white text-center text-sm font-light italic animate-in slide-in-from-bottom-2 shadow-2xl">
                   "{activeSubtitle}"
                   <div className="mt-2 flex justify-center gap-1">
                       <span className="w-1 h-2 bg-amber-500 animate-[bounce_0.6s_infinite]"></span>
                       <span className="w-1 h-2 bg-amber-500 animate-[bounce_0.6s_infinite_0.1s]"></span>
                       <span className="w-1 h-2 bg-amber-500 animate-[bounce_0.6s_infinite_0.2s]"></span>
                   </div>
                 </div>
               )}
            </div>

            <div className="px-8 -mt-10 relative z-10 space-y-6 max-w-2xl mx-auto">
               <h2 className="text-4xl font-black text-white italic tracking-tight uppercase drop-shadow-lg">{scene?.title || "A Jornada Começa"}</h2>
               
               {isLoading ? (
                 <div className="flex items-center gap-4 text-amber-500 font-black text-sm uppercase tracking-[0.3em] animate-pulse">
                    <FastForward size={22} className="animate-bounce" /> O Oráculo está tecendo o destino...
                 </div>
               ) : (
                 <div className="text-xl text-slate-200 leading-relaxed font-light italic whitespace-pre-line drop-shadow-md">
                   {scene?.narration || "Aguardando o destino se manifestar..."}
                 </div>
               )}

               {!isLoading && scene?.options && (
                 <div className="grid gap-4 pt-6">
                   {scene.options.map((opt: any, i: number) => (
                     <button key={i} onClick={() => { setPendingAction(opt); setStep('rolling'); window.speechSynthesis.cancel(); if (audioRef.current) audioRef.current.pause(); }} className="w-full p-6 bg-white/5 border border-white/10 rounded-[2rem] flex items-center justify-between hover:bg-amber-600 hover:text-black transition-all group shadow-lg cursor-pointer">
                       <div className="text-left">
                         <div className="font-bold text-lg uppercase tracking-tight">{opt.text}</div>
                         <div className="text-[10px] opacity-60 uppercase font-bold mt-1 tracking-widest">DC {opt.dc} • {opt.attribute}</div>
                       </div>
                       <ChevronRight size={26} className="text-slate-700 group-hover:text-black" />
                     </button>
                   ))}
                 </div>
               )}
               
               {/* Botão discreto para repetir áudio se necessário */}
               {!isLoading && scene && (
                   <button 
                    onClick={() => generateTTS(scene.narration)} 
                    className="flex items-center gap-2 text-[10px] uppercase text-slate-500 font-bold hover:text-amber-500 transition-colors cursor-pointer"
                   >
                       <RefreshCw size={12} /> Repetir Narração
                   </button>
               )}
            </div>
          </main>

          <footer className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black via-black/95 to-transparent z-50 text-center pointer-events-none">
              <div className="flex flex-col items-center gap-2">
                <p className="text-[10px] uppercase text-amber-500/40 font-black tracking-[0.5em] animate-pulse">
                    {isTalking ? "O Oráculo está a narrar" : "O Destino Aguarda"}
                </p>
                {isTalking && (
                    <div className="flex gap-1">
                        {[1,2,3,4,5].map(i => (
                            <div key={i} className={`w-0.5 h-3 bg-amber-500/30 rounded-full animate-[bounce_1s_infinite_${i*0.2}s]`}></div>
                        ))}
                    </div>
                )}
              </div>
          </footer>
        </>
      )}

      {/* Toast de Novos Itens */}
      {newItemsToast.length > 0 && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[200] w-full max-w-xs animate-in slide-in-from-top-4 duration-500">
          <div className="bg-amber-600 text-black p-4 rounded-2xl shadow-2xl flex flex-col gap-2">
            <div className="flex items-center gap-2 font-black uppercase text-xs">
              <Sparkles size={16} /> Item Adquirido!
            </div>
            {newItemsToast.map((item, idx) => (
              <div key={idx} className={`flex items-center gap-3 bg-black/10 p-2 rounded-xl border ${item.rarity === 'lendário' ? 'border-amber-400/50 animate-pulse' : 'border-transparent'}`}>
                {renderItemIcon(item.icon, item.rarity)}
                <div>
                  <div className="font-bold text-sm flex items-center gap-2">
                    {item.name}
                    {item.rarity && (
                      <span className="text-[8px] px-1 rounded bg-black/20 uppercase tracking-tighter">
                        {item.rarity}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] opacity-80">{item.description}</div>
                  {item.effect && (
                    <div className="text-[9px] font-bold text-black bg-white/40 px-1.5 py-0.5 rounded mt-1 inline-block">
                      {item.effect}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de Inventário */}
      {isInventoryOpen && (
        <div className="fixed inset-0 z-[400] bg-black/95 backdrop-blur-md flex flex-col p-8 animate-in fade-in duration-300">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-4xl font-black italic text-white">Inventário</h2>
            <button 
              onClick={() => setIsInventoryOpen(false)}
              className="p-3 rounded-full bg-white/5 text-white hover:bg-white/10 transition-all cursor-pointer"
            >
              <X size={24} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 max-w-xl mx-auto w-full">
            {character?.inventory?.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500 space-y-4">
                <Package size={48} className="opacity-20" />
                <p className="uppercase tracking-widest text-xs font-bold">Seu alforje está vazio</p>
              </div>
            ) : (
              character.inventory.map((item: any, idx: number) => (
                <div key={idx} className={`p-6 bg-white/5 border rounded-3xl flex items-center gap-6 group transition-all ${item.rarity === 'lendário' ? 'border-amber-500/40 shadow-[0_0_20px_rgba(251,191,36,0.1)]' : 'border-white/10 hover:border-amber-500/50'}`}>
                  <div className={`p-4 rounded-2xl group-hover:scale-110 transition-transform ${item.rarity === 'lendário' ? 'bg-amber-500/20' : 'bg-amber-600/10'}`}>
                    {renderItemIcon(item.icon, item.rarity)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className={`text-xl font-bold ${item.rarity === 'lendário' ? 'text-amber-400' : 'text-white'}`}>{item.name}</h3>
                      {item.effect && (
                        <span className="text-[10px] font-black uppercase bg-amber-600/20 text-amber-500 px-2 py-0.5 rounded-lg border border-amber-500/20">
                          {item.effect}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-400 italic">{item.description}</p>
                    {item.rarity && (
                      <div className="mt-1 text-[9px] font-bold uppercase tracking-widest opacity-40">
                        Qualidade: {item.rarity}
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => {
                      setCharacter((prev: any) => ({
                        ...prev,
                        inventory: prev.inventory.filter((_: any, i: number) => i !== idx)
                      }));
                    }}
                    className="p-2 text-slate-600 hover:text-red-500 transition-colors cursor-pointer"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))
            )}
          </div>
          
          <div className="mt-8 text-center">
            <p className="text-[10px] uppercase text-slate-600 font-bold tracking-widest">
              {character?.inventory?.length || 0} Itens Carregados
            </p>
          </div>
        </div>
      )}

      {/* Overlay de Dados */}
      {step === 'rolling' && (
        <div className="fixed inset-0 z-[300] bg-black/98 flex flex-col items-center justify-center p-12 animate-in fade-in duration-300">
           <div className="text-center space-y-12 w-full max-w-sm">
              <div className="space-y-4">
                <h3 className="text-amber-500 text-xl uppercase tracking-[0.6em] font-black italic">Selo da Sorte</h3>
                <p className="text-slate-400 italic text-2xl font-light">"{pendingAction?.text}"</p>
              </div>

              <div 
                onClick={() => {
                  if (diceResult || isRolling) return;
                  
                  setIsRolling(true);
                  const diceType = pendingAction?.diceType || 'D20';
                  const sides = parseInt(diceType.replace('D', '')) || 20;
                  
                  // Animation interval
                  const interval = setInterval(() => {
                    setRollingValue(Math.floor(Math.random() * sides) + 1);
                  }, 80);

                  setTimeout(() => {
                    clearInterval(interval);
                    const roll = Math.floor(Math.random() * sides) + 1;
                    setRollingValue(roll);
                    setIsRolling(false);
                    
                    const statVal = character?.stats?.[pendingAction?.attribute] || 10;
                    const mod = Math.floor((statVal - 10) / 2);
                    const success = (roll + mod) >= (pendingAction?.dc || 10);
                    const isCritical = roll === sides || roll === 1;
                    setDiceResult({ roll, mod, success, isCritical });
                    
                    setTimeout(() => {
                      setStep('playing');
                      let resultText = success ? 'SUCESSO' : 'FALHA';
                      if (roll === sides) resultText = 'SUCESSO CRÍTICO';
                      if (roll === 1) resultText = 'FALHA CRÍTICA';
                      
                      loadScene(`O jogador agiu (${pendingAction?.text}). O dado ${diceType} selou um ${roll} (+${mod}). Resultado: ${resultText}. Narre a consequência de forma impactante!`);
                      setDiceResult(null);
                      setRollingValue(1);
                    }, 2500);
                  }, 1200);
                }}
                className="cursor-pointer"
              >
                {renderDiceVisual(pendingAction?.diceType, isRolling ? rollingValue : (diceResult ? diceResult.roll : 20), isRolling)}
              </div>

              <div className="h-24">
                {diceResult && (
                  <div className="animate-in slide-in-from-top-4 duration-500">
                    <div className={`text-6xl font-black uppercase italic tracking-tighter ${diceResult.isCritical ? 'animate-pulse scale-110' : ''} ${diceResult.success ? 'text-green-400' : 'text-red-600'}`}>
                      {diceResult.roll === (parseInt(pendingAction?.diceType?.replace('D', '')) || 20) ? "CRÍTICO!" : (diceResult.roll === 1 ? "DESASTRE!" : (diceResult.success ? "TRIUNFO!" : "DESTINO..."))}
                    </div>
                  </div>
                )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
