document.addEventListener("DOMContentLoaded", () => {
  const keyInput = document.getElementById("enc-key");
  const saveBtn = document.getElementById("save-btn");
  const statusMsg = document.getElementById("status-msg");

  // Load existing key
  chrome.storage.local.get(["encryption_key"], (result) => {
    if (result.encryption_key) {
      keyInput.value = result.encryption_key;
    } else {
      keyInput.value = '';
    }
  });

  saveBtn.addEventListener("click", () => {
    const rawKey = keyInput.value.trim();

    chrome.storage.local.set({ encryption_key: rawKey }, () => {
      statusMsg.textContent = "Key saved successfully!";
      setTimeout(() => {
        statusMsg.textContent = "";
      }, 2000);
    });
  });
});
