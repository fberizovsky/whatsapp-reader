import React, { useState, ChangeEvent, useEffect } from 'react';
import './WhatsAppViewer.css';
import JSZip from 'jszip';

// Definición de tipos
interface Message {
  timestamp: string;
  sender: string;
  text: string;
  mediaType?: 'image' | 'audio' | 'sticker' | 'video';
  mediaUrl?: string;
  mediaName?: string;
}

interface MediaFiles {
  [key: string]: string; // nombre del archivo -> URL del objeto
}

const WhatsAppChatViewer: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [mediaFiles, setMediaFiles] = useState<MediaFiles>({});
  const [chatParticipants, setChatParticipants] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<string>('');

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    
    try {
      // Si es un archivo ZIP
      if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
        await handleZipUpload(file);
      } else {
        // Si solo es un archivo TXT
        const reader = new FileReader();
        reader.onload = (e: ProgressEvent<FileReader>) => {
          const text = e.target?.result as string;
          const parsedMessages = parseWhatsAppChat(text);
          setMessages(parsedMessages);
          
          // Identificar participantes del chat
          identifyChatParticipants(parsedMessages);
          
          setLoading(false);
        };
        reader.readAsText(file);
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setLoading(false);
    }
  };

  const handleZipUpload = async (file: File) => {
    try {
      const zip = new JSZip();
      const contents = await zip.loadAsync(file);
      const mediaFilesMap: MediaFiles = {};
      let chatText = '';

      // Procesar los archivos en el ZIP
      const processPromises = Object.keys(contents.files).map(async (filename) => {
        const zipEntry = contents.files[filename];
        
        // Ignora los directorios
        if (zipEntry.dir) return;

        // Si es el archivo de chat
        if (filename.endsWith('.txt') || filename === '_chat.txt') {
          const text = await zipEntry.async('text');
          chatText = text;
        } 
        // Si es un archivo multimedia
        else if (isMediaFile(filename)) {
          const blob = await zipEntry.async('blob');
          const url = URL.createObjectURL(blob);
          mediaFilesMap[filename] = url;
        }
      });

      await Promise.all(processPromises);

      // Parsear el chat después de procesar todos los archivos
      if (chatText) {
        const parsedMessages = parseWhatsAppChat(chatText, mediaFilesMap);
        setMessages(parsedMessages);
        setMediaFiles(mediaFilesMap);
        
        // Identificar participantes del chat
        identifyChatParticipants(parsedMessages);
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error processing ZIP file:', error);
      setLoading(false);
    }
  };

  // Identifica a los participantes del chat
  const identifyChatParticipants = (messages: Message[]) => {
    // Extraer nombres únicos de remitentes
    const uniqueSenders = Array.from(new Set(messages.map(msg => msg.sender)));
    setChatParticipants(uniqueSenders);
    
    // Establecer el primer remitente como usuario actual por defecto
    if (uniqueSenders.length > 0 && !currentUser) {
      setCurrentUser(uniqueSenders[0]);
    }
  };

  // Cambia la perspectiva del chat
  const switchPerspective = () => {
    if (chatParticipants.length > 1) {
      // Cambiar al siguiente participante en la lista
      const currentIndex = chatParticipants.indexOf(currentUser);
      const nextIndex = (currentIndex + 1) % chatParticipants.length;
      setCurrentUser(chatParticipants[nextIndex]);
    }
  };

  const isMediaFile = (filename: string): boolean => {
    const lowerFilename = filename.toLowerCase();
    return (
      // Imágenes
      lowerFilename.endsWith('.jpg') || 
      lowerFilename.endsWith('.jpeg') || 
      lowerFilename.endsWith('.png') || 
      lowerFilename.endsWith('.webp') || // Stickers
      // Audio
      lowerFilename.endsWith('.ogg') ||  
      lowerFilename.endsWith('.opus') || 
      lowerFilename.endsWith('.mp3') || 
      // Video
      lowerFilename.endsWith('.mp4') ||
      lowerFilename.endsWith('.mov') ||   // Videos MOV (formato de Apple)
      lowerFilename.endsWith('.avi') ||
      lowerFilename.endsWith('.mkv')
    );
  };

  const getMediaType = (filename: string): 'image' | 'audio' | 'sticker' | 'video' | undefined => {
    const lowerFilename = filename.toLowerCase();
    if (lowerFilename.endsWith('.webp')) return 'sticker';
    if (lowerFilename.endsWith('.ogg') || lowerFilename.endsWith('.mp3') || lowerFilename.endsWith('.opus')) return 'audio';
    if (lowerFilename.endsWith('.jpg') || lowerFilename.endsWith('.jpeg') || lowerFilename.endsWith('.png')) return 'image';
    if (lowerFilename.endsWith('.mp4') || lowerFilename.endsWith('.mov') || lowerFilename.endsWith('.avi') || lowerFilename.endsWith('.mkv')) return 'video';
    return undefined;
  };

  const parseWhatsAppChat = (text: string, media: MediaFiles = {}): Message[] => {
    // Patrón para detectar mensajes de WhatsApp
    // Formato típico: [DD/MM/YY, HH:MM:SS] Nombre: Mensaje
    const messageRegex = /\[?(\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)\]?\s*-?\s*([^:]+):\s*([\s\S]+?)(?=\[\d{1,2}\/\d{1,2}\/\d{2,4}|$)/gi;
    
    const messages: Message[] = [];
    let match;
    
    while ((match = messageRegex.exec(text)) !== null) {
      if (match.length >= 4) {
        const message: Message = {
          timestamp: match[1].trim(),
          sender: match[2].trim(),
          text: match[3].trim()
        };

        // Comprobar si hay archivos adjuntos mencionados en el mensaje
        // Patrones comunes en los mensajes de WhatsApp para archivos adjuntos
        const attachmentRegex = /<adjunto: ([^>]+)>|adjunto: ([^\n]+)|(\S+\.(jpg|jpeg|png|webp|ogg|opus|mp3|mp4|mov|avi|mkv))/i;
        const attachmentMatch = message.text.match(attachmentRegex);
        
        if (attachmentMatch) {
          const fileName = attachmentMatch[1] || attachmentMatch[2] || attachmentMatch[3];
          if (fileName) {
            // Buscar el archivo en nuestros medios
            const mediaFileKey = Object.keys(media).find(key => 
              key.includes(fileName) || key.endsWith(fileName)
            );
            
            if (mediaFileKey) {
              message.mediaName = mediaFileKey;
              message.mediaUrl = media[mediaFileKey];
              message.mediaType = getMediaType(mediaFileKey);
              // Eliminar la referencia al archivo adjunto del texto si aparece como un patrón específico
              if (attachmentMatch[0].startsWith('<adjunto:') || attachmentMatch[0].startsWith('adjunto:')) {
                message.text = message.text.replace(attachmentRegex, '').trim();
              }
            }
          }
        }

        messages.push(message);
      }
    }
    
    return messages;
  };

  // Determina si el remitente es "yo" o alguien más para aplicar diferentes estilos
  const isMe = (sender: string): boolean => {
    return sender === currentUser;
  };

  // Limpia la memoria cuando el componente se desmonte
  useEffect(() => {
    return () => {
      // Liberar las URLs de objetos cuando el componente se desmonte
      Object.values(mediaFiles).forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, [mediaFiles]);

  // Renderiza el contenido multimedia según su tipo
  const renderMedia = (message: Message) => {
    if (!message.mediaUrl || !message.mediaType) return null;

    switch (message.mediaType) {
      case 'image':
      case 'sticker':
        return (
          <img 
            src={message.mediaUrl} 
            alt={message.mediaName || 'Media attachment'} 
            className={message.mediaType === 'sticker' ? 'sticker-media' : 'image-media'}
          />
        );
      case 'audio':
        return (
          <div className="audio-container">
            <audio controls src={message.mediaUrl} className="audio-media" />
            <span className="audio-filename">{message.mediaName}</span>
          </div>
        );
      case 'video':
        return (
          <div className="video-container">
            <video controls src={message.mediaUrl} className="video-media" />
            <span className="video-filename">{message.mediaName}</span>
          </div>
        );
      default:
        return <span className="media-attachment">Archivo adjunto: {message.mediaName}</span>;
    }
  };

  return (
    <div className="whatsapp-viewer">
      <div className="header">
        <h1>Visualizador de Chat de WhatsApp</h1>
        <input 
          type="file" 
          accept=".txt,.zip" 
          onChange={handleFileUpload} 
          className="file-input"
        />
        
        {chatParticipants.length > 1 && (
          <div className="perspective-control">
            <span>Perspectiva actual: <strong>{currentUser}</strong></span>
            <button 
              onClick={switchPerspective} 
              className="switch-button"
            >
              Cambiar perspectiva
            </button>
          </div>
        )}
      </div>
      
      <div className="chat-container">
        {loading && <div className="loading">Cargando chat y medios...</div>}
        
        {messages.length > 0 ? (
          <div className="messages">
            {messages.map((message, index) => (
              <div 
                key={index} 
                className={`message ${isMe(message.sender) ? 'message-me' : 'message-other'}`}
              >
                <div className="message-info">
                  <span className="sender">{message.sender}</span>
                  <span className="timestamp">{message.timestamp}</span>
                </div>
                {message.text && <div className="message-text">{message.text}</div>}
                {message.mediaUrl && (
                  <div className="message-media">
                    {renderMedia(message)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : !loading && (
          <div className="no-messages">
            <p>Carga tu archivo de chat exportado de WhatsApp (.txt o .zip) para visualizarlo aquí.</p>
            <p className="hint">Abre un chat en WhatsApp → Menú → Más → Exportar chat → Con archivos</p>
          </div>
        )}
      </div>
      <div className="footer">
        <h1>Como te vas a olvidar el PIN!!!!!!</h1>
      </div>
    </div>
  );
};

export default WhatsAppChatViewer;