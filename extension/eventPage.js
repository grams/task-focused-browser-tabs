//// Utilities ---------------------------------------------------------------------------------------------------------

taskFocusedTabsURL = chrome.extension.getURL("taskFocusedTabs.html");
function isTasksTab(tab) {
    return (tab.url.replace(/#*$/, "") == taskFocusedTabsURL);
}

//// Extension actions -------------------------------------------------------------------------------------------------

// Extension button clicked
chrome.browserAction.onClicked.addListener(function (activeTab) {
    chrome.windows.get(activeTab.windowId, {
        populate: true
    }, function (window) {
        for (var tab of window.tabs) {
            if (isTasksTab(tab)) {
                chrome.tabs.update(tab.id, {
                    active: true
                });
                return;
            }
        }
        chrome.tabs.create({
            url: taskFocusedTabsURL
        });
    });
});

//// Update tasks tabs on change ---------------------------------------------------------------------------------------

function refresh(windowId) {
    chrome.tabs.query({
        windowId: windowId
    }, function (tabs) {
        console.log("refreshing window: " + windowId);
        try {
            var urls = [];
            var isAllComplete = true;
            var taskFocusedTabsTab = null;
            for (var tab of tabs) {
                if (taskFocusedTabsTab == null) {
                    if (isTasksTab(tab)) {
                        taskFocusedTabsTab = tab;
                    }
                } else {
                    console.debug("This task has tab: " + tab.url + " (" + tab.status + ")");
                    if (tab.status != "complete") {
                        isAllComplete = false;
                    }
                    urls.push(tab.url);
                }
            }
            if (taskFocusedTabsTab != null) {
                view = chrome.extension.getViews({
                    type: 'tab',
                    windowId: windowId
                })[0];
                if (view) {
                    view.focusTabsRefresh(urls, isAllComplete);
                }
            }
        } catch (e) {
            console.error("Error while refreshing window: " + windowId, e);
        }
    });
}

//// Listeners on all tab operations that call refresh(windowId) -------------------------------------------------------

// Loaded
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (tab.status == "loading") {
        console.debug("Still loading tab " + tabId, changeInfo);
        return;
    }

    console.debug("Updated tab: " + tabId, changeInfo, tab);

    if (isTasksTab(tab)) {
        taskFocusedTab = tab;
        return;
    }

    refresh(tab.windowId);
});

// Removed tab
chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
    console.debug("Removed tab: " + tabId, removeInfo);

    if (removeInfo.isWindowClosing) {
        // We don't want to accidently update tasks with zero tabs
        return;
    }

    refresh(removeInfo.windowId);
});

// Created tab
chrome.tabs.onCreated.addListener(function (tab) {
    console.debug("Created tab " + tab.id + ": " + tab.url, tab);

    if (!tab.openerTabId && tab.active) {
        view = chrome.extension.getViews({
            type: 'tab',
            windowId: tab.windowId
        })[0];
        if (view) {
            view.moveTabOutOfTask(tab);
        }
    }
});

// Moved inside window
chrome.tabs.onMoved.addListener(function (tabId, moveInfo) {
    console.debug("Moved tab: " + tabId, moveInfo);

    refresh(moveInfo.windowId);
});

// Moved between windows
chrome.tabs.onAttached.addListener(function (tabId, attachInfo) {
    console.debug("Attached tab: " + tabId, attachInfo);

    refresh(attachInfo.newWindowId);
});
chrome.tabs.onDetached.addListener(function (tabId, detachInfo) {
    console.debug("Detached tab: " + tabId, detachInfo);

    refresh(detachInfo.oldWindowId);
});

//// Extension lifecycle management ------------------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(function () {
    //console.debug("INSTALLED");
});
