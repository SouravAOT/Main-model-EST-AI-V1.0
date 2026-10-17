
function toggleVoiceCallMic() {
  if (!voiceCallActive) return;

  const btn = document.getElementById("voiceCallMicBtn");
  const status = document.getElementById("voiceCallStatus");
  const orb = document.getElementById("voiceCallOrb");

  // Agar AI bol raha hai, speech rok kar user ko bolne do.
  if (voiceCallBusy) {
    cancelVoiceCallOutput();

    voiceCallBusy = false;
    voiceCallSpokenText = "";

    if (voiceCallSilenceTimer) {
      clearTimeout(voiceCallSilenceTimer);
      voiceCallSilenceTimer = null;
    }

    stopVoiceCallRecognition();
    stopVoiceCallMeter();

    voiceCallManualStop = false;
    voiceCallHasSpeech = false;
    voiceCallFinalBuffer = "";
    voiceCallFinalByIndex = new Map();
    voiceCallInterimByIndex = new Map();

    btn?.classList.remove("muted");
    orb?.classList.remove("thinking", "speaking");
    orb?.classList.add("listening");

    if (status) {
      status.textContent = "AI speech stopped. Speak now.";
    }

    startVoiceCallRecognition();
    startVoiceCallMeter();
    return;
  }

  // Agar mic pehle se listening kar raha hai, transcription finish karo.
  if (voiceCallRecognition) {
    voiceCallManualStop = true;

    if (status) {
      status.textContent = "Finishing transcription…";
    }

    try {
      voiceCallRecognition.stop();
    } catch (error) {
      console.warn("Could not stop voice recognition:", error);
    }

    return;
  }

  // Mic listening shuru karo.
  voiceCallManualStop = false;
  voiceCallHasSpeech = false;
  voiceCallFinalBuffer = "";
  voiceCallFinalByIndex = new Map();
  voiceCallInterimByIndex = new Map();

  btn?.classList.remove("muted");
  orb?.classList.remove("thinking", "speaking");
  orb?.classList.add("listening");

  if (status) {
    status.textContent = "Listening — speak now.";
  }

  startVoiceCallRecognition();
  startVoiceCallMeter();
}
