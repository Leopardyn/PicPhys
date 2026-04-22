const video = document.getElementById('cameraApp');
const compositeCanvas = document.getElementById('compositeCanvas');
const compositeCtx = compositeCanvas.getContext('2d', { willReadFrequently: true });
const processCanvas = document.getElementById('processCanvas');
const processCtx = processCanvas.getContext('2d', { willReadFrequently: true });

const freqSlider = document.getElementById('freqSlider');
const freqValueText = document.getElementById('freqValue');
const threshSlider = document.getElementById('threshSlider');
const threshValueText = document.getElementById('threshValue');
const exposureSlider = document.getElementById('exposureSlider');
const exposureValueText = document.getElementById('exposureValue');
const exposureControlGroup = document.getElementById('exposureControlGroup');
const btnCapture = document.getElementById('btnCapture');
const btnStop = document.getElementById('btnStop');
const btnReset = document.getElementById('btnReset');
const btnDownload = document.getElementById('btnDownload');
const statusIndicator = document.getElementById('statusIndicator');

let stream = null;
let captureIntervalId = null;
let isCapturing = false;

// Configurações do processamento
let freq = parseInt(freqSlider.value);
let threshold = parseInt(threshSlider.value);
let videoWidth = 0;
let videoHeight = 0;

let refBgData = null;
let compositeData = null;

// Inicializa Câmera
async function initCamera() {
    try {
        const constraints = {
            video: {
                facingMode: 'environment', // Câmera traseira
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        
        const videoTrack = stream.getVideoTracks()[0];
        
        // Verifica suporte a controle de exposição (aguarda um pouco para leitura das capabilities)
        setTimeout(() => {
            if (!videoTrack) return;
            try {
                const capabilities = videoTrack.getCapabilities();
                if (capabilities.exposureMode && capabilities.exposureTime) {
                    exposureControlGroup.style.display = 'flex';
                    exposureSlider.min = capabilities.exposureTime.min;
                    exposureSlider.max = capabilities.exposureTime.max;
                    exposureSlider.step = capabilities.exposureTime.step || 1;
                    
                    const settings = videoTrack.getSettings();
                    exposureSlider.value = settings.exposureTime || capabilities.exposureTime.max;
                    exposureValueText.textContent = exposureSlider.value;
                    
                    // Tenta aplicar manual na inicialização
                    videoTrack.applyConstraints({
                        advanced: [{ exposureMode: 'manual', exposureTime: parseFloat(exposureSlider.value) }]
                    }).catch(e => console.warn(e));
                    
                    exposureSlider.addEventListener('input', async (e) => {
                        const val = parseFloat(e.target.value);
                        exposureValueText.textContent = val;
                        try {
                            await videoTrack.applyConstraints({
                                advanced: [{ exposureMode: 'manual', exposureTime: val }]
                            });
                        } catch (err) {
                            console.error("Erro ao aplicar exposição:", err);
                        }
                    });
                }
            } catch (err) {
                console.warn("API de Advanced Camera Controls não suportada", err);
            }
        }, 500);

        video.onloadedmetadata = () => {
            videoWidth = video.videoWidth;
            videoHeight = video.videoHeight;
            
            // Configurar tamanhos dos canvases
            compositeCanvas.width = videoWidth;
            compositeCanvas.height = videoHeight;
            processCanvas.width = videoWidth;
            processCanvas.height = videoHeight;
        };
    } catch (err) {
        console.error("Erro ao acessar a câmera:", err);
        statusIndicator.textContent = "Erro de Câmera";
        statusIndicator.style.background = "rgba(239, 68, 68, 0.8)";
        alert("Não foi possível acessar a câmera do seu dispositivo. Verifique as permissões.");
    }
}

// Sliders Eventos
freqSlider.addEventListener('input', (e) => {
    freq = parseInt(e.target.value);
    freqValueText.textContent = freq;
    // Se estiver gravando, reiniciar o intervalo com a nova frequência
    if (isCapturing) {
        stopInterval();
        startInterval();
    }
});

threshSlider.addEventListener('input', (e) => {
    threshold = parseInt(e.target.value);
    threshValueText.textContent = threshold;
});

// Ações dos botões
btnCapture.addEventListener('click', startCapture);
btnStop.addEventListener('click', stopCapture);
btnReset.addEventListener('click', resetCanvas);
btnDownload.addEventListener('click', downloadFinalImage);

function captureFrame() {
    processCtx.drawImage(video, 0, 0, videoWidth, videoHeight);
    return processCtx.getImageData(0, 0, videoWidth, videoHeight);
}

function startCapture() {
    if (videoWidth === 0 || videoHeight === 0) return;
    
    // Captura primeiro frame como fundo de referência
    if (!refBgData) {
        const initialFrame = captureFrame();
        refBgData = initialFrame;
        // Iniciar composite com o background
        compositeData = new ImageData(
            new Uint8ClampedArray(initialFrame.data),
            videoWidth,
            videoHeight
        );
        compositeCtx.putImageData(compositeData, 0, 0);
    }
    
    isCapturing = true;
    btnCapture.disabled = true;
    btnStop.disabled = false;
    statusIndicator.textContent = "Gravando...";
    statusIndicator.classList.add('recording');
    
    startInterval();
}

function stopCapture() {
    isCapturing = false;
    btnCapture.disabled = false;
    btnStop.disabled = true;
    statusIndicator.textContent = "Pausado";
    statusIndicator.classList.remove('recording');
    stopInterval();
}

function startInterval() {
    const intervalMs = 1000 / freq;
    captureIntervalId = setInterval(processNextFrame, intervalMs);
}

function stopInterval() {
    if (captureIntervalId) {
        clearInterval(captureIntervalId);
        captureIntervalId = null;
    }
}

function resetCanvas() {
    stopCapture();
    refBgData = null;
    compositeData = null;
    compositeCtx.clearRect(0, 0, videoWidth, videoHeight);
    statusIndicator.textContent = "Câmera Pronta";
    statusIndicator.classList.remove('recording');
}

function processNextFrame() {
    if (!refBgData || !compositeData) return;
    
    const curFrame = captureFrame();
    const cur = curFrame.data;
    const ref = refBgData.data;
    const cmp = compositeData.data;
    
    const threshSq = threshold * threshold;
    const len = cur.length;
    let hasMotion = false;
    
    for (let i = 0; i < len; i += 4) {
        const dr = cur[i] - ref[i];
        const dg = cur[i+1] - ref[i+1];
        const db = cur[i+2] - ref[i+2];
        const distSq = dr*dr + dg*dg + db*db;
        
        if (distSq > threshSq) {
            // Objeto detectado! Sobrescreve na imagem composta final.
            cmp[i] = cur[i];
            cmp[i+1] = cur[i+1];
            cmp[i+2] = cur[i+2];
            cmp[i+3] = 255;
            hasMotion = true;
        }
    }
    
    if (hasMotion) {
        compositeCtx.putImageData(compositeData, 0, 0);
    }
}

function downloadFinalImage() {
    if (!refBgData) {
        alert("Capture alguma coisa primeiro!");
        return;
    }
    
    const link = document.createElement('a');
    link.download = `stroboscopic_${new Date().getTime()}.png`;
    link.href = compositeCanvas.toDataURL('image/png');
    link.click();
}

// Inicia
window.addEventListener('load', initCamera);
