/*
    This file is part of task-focused-browser-tabs extension for chrome.

    task-focused-browser-tabs is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    task-focused-browser-tabs is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with task-focused-browser-tabs.  If not, see <https://www.gnu.org/licenses/>.
 */
"use strict";


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Utilities
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Constants
const OPENTASK_DATA = "open-task";
const JUMPTOFIRST_DATA = "jump-to-first";
const TABS_DATA = "tabs";
const KIND_DATA = "kind";
const INDEX_DATA = "index";
const EXTENSION_URL = chrome.extension.getURL("taskFocusedTabs.html");
const TASK_SELECTOR = "li.task";
const TASK_LABEL_SELECTOR = ".title";
const LIST_LABEL_SELECTOR = ".list-label";
const TASKS_LIST_SELECTOR = ".tasks-list";
const KEYCODE_ENTER = 13;
const KEYCODE_ESCAPE = 27;

// This should be included in jQuery :-/
$.fn.extend({
    /**
     * @return {boolean} true if jQuery selector has found something
     */
    exists: function () {
        return this.length > 0;
    }
});

/**
 * Return true if given browser tab is this extension home tab
 * @param {!Object} tab a browser tab
 * @return {boolean} true if given browser tab is this extension home tab
 */
function isExtensionTab(tab) {
    return tab.url.replace(/#*$/, "") === EXTENSION_URL;
}

/**
 * Returns a unique task name from the given name, adding (1) or (2) or... if needed.
 * @param text a tentative task name
 * @return {string} a unique task name
 */
function dedupTaskNames(text) {
    if (!text.trim()) {
        text = chrome.i18n.getMessage("new_task");
    }

    text = text.replace(/\s\(\d+\)$/, "");

    const tasksNames = [];
    $(TASK_SELECTOR).each(function () {
        tasksNames.push($(this).taskGetLabel());
    });

    if ($.inArray(text, tasksNames) >= 0) {
        let count = 1;
        while (($.inArray(text + " (" + count + ")", tasksNames) >= 0) && (count < 1000 /* infinite loop? */)) {
            count++;
        }
        text = `${text} (${count})`;
    }
    return text;
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Tasks board methods
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * One may wonder why such a convoluted way of storing data in google sync.
 * The straightforward approach who be a single tree-like structure in a single key-value pair, but this approach fails
 * because of the (small actually) limit on the size of a value.
 * The solution is to turn the structure into a very flat list of key-values, using a counter for keys and objects as
 * values.
 */
function getFlattenedTasksDict() {
    const flattenedMap = {};
    let tasksCounter = 0;
    $(TASK_SELECTOR).each(function () {
        flattenedMap[tasksCounter++] = $(this).taskGetDefinition();
    });

    // Now hide config within tasks
    flattenedMap[tasksCounter++] = {
        label: '__config__',
        kind: '_',
        tabs: [
            $('#TLabel .btn').text().trim(),
            $('#ALabel .btn').text().trim(),
            $('#SLabel .btn').text().trim(),
            $('#KLabel .btn').text().trim(),
            $('#TLabel').data(OPENTASK_DATA),
            $('#ALabel').data(OPENTASK_DATA),
            $('#SLabel').data(OPENTASK_DATA),
            $('#KLabel').data(OPENTASK_DATA),
            $('#TLabel').data(JUMPTOFIRST_DATA),
            $('#ALabel').data(JUMPTOFIRST_DATA),
            $('#SLabel').data(JUMPTOFIRST_DATA),
            $('#KLabel').data(JUMPTOFIRST_DATA),
        ]
    };

    // Try to gain a little storage space by shortening "kind" to "k", and removing "http" from URLs
    for (let j = 0; j < tasksCounter; j++) {
        const compressedURLs = flattenedMap[j].tabs.slice(0); // This creates a clone of the array
        if (!/^_/.test(flattenedMap[j].kind)) { // Only compress tab URLS
            for (let k = 0; k < compressedURLs.length; k++) {
                compressedURLs[k] = compressedURLs[k].replace(/^http/, "");
            }
        }
        flattenedMap[j] = {
            l: flattenedMap[j].label,
            k: flattenedMap[j].kind,
            t: compressedURLs
        };
    }
    return flattenedMap;
}

/**
 * Save all data for everything in extension screen (tasks, tabs, configuration).
 * {@see getFlattenedTasksDict}
 */
function saveExtensionData() {
    const tasksAsFlatDict = getFlattenedTasksDict();

    // Save it using the Chrome extension storage API.
    console.debug("Saving tabs data...", tasksAsFlatDict);

    chrome.storage.sync.set(
        tasksAsFlatDict,
        function () {
            if (chrome.runtime.lastError) {
                console.error(`Error while saving tabs: ${chrome.runtime.lastError.message}`, chrome.runtime.lastError);
            } else {
                console.info("Tabs data saved.");
            }
        });

    // Saving will not remove past entries
    chrome.storage.sync.remove(
        Object.keys(tasksAsFlatDict).length.toString(),
        function () {
            if (chrome.runtime.lastError) {
                console.debug(`No entry to delete: ${chrome.runtime.lastError.message}`, chrome.runtime.lastError);
            } else {
                console.debug("Removed last past entry.");
            }
        });
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Functions called from extension event page scripts (eventPage.js)
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function focusTabsRefresh(urls, isAllComplete) {
    try {
        const $selectedTask = $(TASK_SELECTOR + ".active").first();
        if (!$selectedTask.exists()) {
            console.debug("No task currently active.", $selectedTask);
            return;
        }

        if ("italic" === $selectedTask.css("fontStyle")) {
            if (isAllComplete) {
                $selectedTask.css("fontStyle", "normal");
                console.debug("All tabs have finished loading.");
                // and continue...
            } else {
                // We are still loading after a task switch. Too soon!
                console.debug("We are still loading after a task switch; too soon to update tasks...");
                return;
            }
        }

        const index = $selectedTask.taskGetLabel();
        console.debug(`Updating tabs data for task: ${index}`);
        $.data($selectedTask.get(0), TABS_DATA, urls);
        $selectedTask.find(".badge").html(urls.length);

        // Save it using the Chrome extension storage API.
        saveExtensionData();
    } catch (e) {
        console.error("Error in focusTabsRefresh!", e);
    }
}

function moveTabOutOfTask(aTab) {
    console.info(`Moving new tab ${aTab.tabId} out of active task tabs: ${aTab}`);

    chrome.tabs.query({
        currentWindow: true
    }, function (tabs) {
        try {
            for (const tab of tabs) {
                if (isExtensionTab(tab)) {
                    chrome.tabs.move(aTab.id, {
                        index: tab.index
                    }, function (tabs) {
                    });
                }
            }
        } catch (e) {
            console.error("Error while moving new tab!", e);
        }
    });
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Task methods
////
//// A task has a name, a kind (identifier of the tasks list it belongs to), a list of URLs (of the tabs to open when
//// working on this task).
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

$.fn.taskGetLabel = function () {
    return this.find(TASK_LABEL_SELECTOR).text();
};

$.fn.taskGetCount = function () {
    return parseInt(this.find(".badge").text());
};

$.fn.taskSetLabel = function (aLabel) {
    return this.find(TASK_LABEL_SELECTOR).text(aLabel);
};

$.fn.taskGetDefinition = function (someKind) {
    return {label: this.find(TASK_LABEL_SELECTOR).text(), kind: this.taskGetKind(), tabs: this.data(TABS_DATA)};
};

$.fn.taskGetKind = function () {
    return this.parent().attr('id');
};

$.fn.taskShow = function () {
    return this.addClass('d-flex').show();
};

$.fn.taskHide = function () {
    return this.removeClass('d-flex').hide();
};

$.fn.taskGetList = function () {
    return this.parent();
};

/**
 * Close all tabs for this (presumably active) task and de-activate.
 */
$.fn.taskCloseTabs = function () {
    console.debug(`Closing tabs for task ${this.taskGetLabel()}`);
    this.removeClass("active");

    chrome.tabs.query({
        currentWindow: true
    }, function (tabs) {
        try {
            let pastExtensionTab = false;
            const tabsToRemove = [];
            for (const tab of tabs) {
                if (pastExtensionTab) {
                    tabsToRemove.push(tab.id);
                } else {
                    pastExtensionTab = isExtensionTab(tab);
                }
            }

            chrome.tabs.remove(tabsToRemove, function () {
            });
        } catch (e) {
            console.error("Error while removing tabs", e);
        }
    });
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// TasksList methods
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Create a new task in this list from the given spec, as the first or last item depending on jump-to-first setting.
 * @param newTask a task specification
 * @param forceLastPosition to ignore jump-to-first setting and create as last item
 * @return {HTMLElement} the new task
 */
$.fn.tasksListAddTask = function (newTask, forceLastPosition) {
    forceLastPosition = forceLastPosition || false;

    const count = newTask.tabs ? newTask.tabs.length : 0;
    const text = newTask.label ? newTask.label : "";

    const $btn = $("<li type='button' class='task list-group-item list-group-item-action d-flex justify-content-between align-items-center'><span class='title'>" + text + "</span><span class='badge badge-secondary badge-pill'>" + count + "</span></li>");
    if (forceLastPosition || !this.tasksListIsJumpToFirst()) {
        $btn.appendTo(this);
    } else {
        $btn.prependTo(this);
    }

    $btn.data(TABS_DATA, newTask.tabs ? newTask.tabs : []);
    $btn.on("dblclick", null, {
        [INDEX_DATA]: text
    }, function (event) {
        const $task = $(this);

        console.debug(`Double-click on task ${$task.taskGetLabel()}`);

        // Jump first?
        if ($task.taskGetList().tasksListIsJumpToFirst()) {
            $task.prependTo($task.parent());
        }

        if ($task.taskGetList().tasksListIsOpenOnDblClick()) {
            // Close tabs of previously selected task
            const $previous = $(TASK_SELECTOR + ".active").first();
            if ($previous.exists()) {
                $previous.taskCloseTabs();

                if ($previous.is($task)) {
                    $previous.css("fontStyle", "normal");
                    return;
                }
            }


            // Now open all tabs of selected task
            const index = $task.index();
            const tabs = $task.data(TABS_DATA);
            if (tabs.length > 0) {
                $task.css("fontStyle", "italic");
            }
            console.debug(`Opening ${tabs.length} tabs for task ${index}: ${$task.taskGetLabel()}`);

            const recursiveOpenTabs = function (remainingURLsArray, $aTask) {
                if (remainingURLsArray.length === 0) {
                    $aTask.addClass("active"); // activated list-item
                } else {
                    chrome.tabs.create({
                        active: false,
                        url: remainingURLsArray[0]
                    }, function () {
                        recursiveOpenTabs(remainingURLsArray.slice(1), $aTask);
                    });
                }
            };
            recursiveOpenTabs(tabs, $task);
        } else {
            // Clone on dblClick
            console.info(`Cloning task: ${$task.taskGetLabel()}`);
            const newTask = $task.taskGetDefinition();
            newTask.label = dedupTaskNames(newTask.label);
            $("#T").tasksListAddTask(newTask);
            saveExtensionData();
        }
    });

    // Popup task context menu
    $btn.on("contextmenu", null, function (event) {
        $("#taskContextMenu").css({
            display: "block",
            left: event.pageX,
            top: event.pageY
        });
        console.debug(`Context menu on task: ${$(event.currentTarget).taskGetLabel()}`);
        $(LIST_LABEL_SELECTOR + ".show").dropdown('hide');
        $("#taskContextMenu").data({
            [KIND_DATA]: $(event.currentTarget).taskGetKind(),
            [INDEX_DATA]: $(event.currentTarget).index()
        });
        return false;
    });

    return $btn;
};

$.fn.tasksListRemoveTaskAt = function (aTaskIndex) {
    this.find("li").eq(aTaskIndex).remove();
};

$.fn.tasksListIsJumpToFirst = function () {
    return this.prev().data(JUMPTOFIRST_DATA);
};

$.fn.tasksListSetJumpToFirst = function (jumpToFirst) {
    this.prev().data(JUMPTOFIRST_DATA, jumpToFirst);
};

$.fn.tasksListIsOpenOnDblClick = function () {
    return this.prev().data(OPENTASK_DATA);
};

$.fn.tasksListSetOpenOnDblClick = function (openOnDblClick) {
    this.prev().data(OPENTASK_DATA, openOnDblClick);
};
$.fn.tasksListSetLabel = function (newLabel) {
    this.find('.btn').first().text(newLabel);
};

$.fn.tasksListGetKind = function () {
    return this.attr('id');
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Init & jQueryUI setup
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

$(function () {
    // Translate UI
    translate();

    // Read data from chrome storage and init screen
    chrome.storage.sync.get(null, function (items) {
        if (chrome.runtime.lastError) {
            console.error("Error while reading tasks from storage: " + chrome.runtime.lastError.message, chrome.runtime.lastError);
            //FIXME ALERT ERROR INSTEAD
        } else {
            // Default values
            const defaultLabel = chrome.i18n.getMessage("TasksLabel");
            $('.tasks-list').each(function () {
                $(this).tasksListSetOpenOnDblClick(true);
                $(this).tasksListSetJumpToFirst(true);
                $(this).tasksListSetLabel(defaultLabel);
            });
            // Backwards compatibility from v0.1.x templates
            $("#A").tasksListSetOpenOnDblClick(false);
            $("#A").tasksListSetJumpToFirst(false);
            $("#A").tasksListSetLabel("Templates" + " ");

            console.info("Read tasks from storage: ", items);
            for (let index in items) {
                if (items.hasOwnProperty(index)) { // I miss Python
                    let task = items[index];

                    // uncompress data
                    if (!task.kind) {
                        task.label = task.l;
                        delete task.l;
                        task.kind = task.k;
                        delete task.k;
                        task.tabs = task.t;
                        delete task.t;
                    }
                    if ("_" === task.kind) {
                        // Yeah some config here, not tasks
                        if (task.tabs.length > 3) {
                            $('#TLabel').data(OPENTASK_DATA, task.tabs[4])
                                .data(JUMPTOFIRST_DATA, task.tabs[8])
                                .find('.btn').first().text(task.tabs[0] + " ");
                            $('#ALabel').data(OPENTASK_DATA, task.tabs[5])
                                .data(JUMPTOFIRST_DATA, task.tabs[9])
                                .find('.btn').first().text(task.tabs[1] + " ");
                            $('#SLabel').data(OPENTASK_DATA, task.tabs[6])
                                .data(JUMPTOFIRST_DATA, task.tabs[10])
                                .find('.btn').first().text(task.tabs[2] + " ");
                            $('#KLabel').data(OPENTASK_DATA, task.tabs[7])
                                .data(JUMPTOFIRST_DATA, task.tabs[11])
                                .find('.btn').first().text(task.tabs[3] + " ");
                        }
                    } else {
                        // Prepare future versions by ignoring all starting with _
                        if (!/^_/.test(task.kind)) {
                            // Now we do have a task, uncompress tab URLs
                            for (let i = 0; i < task.tabs.length; i++) {
                                if (/^s?:\/\//.test(task.tabs[i])) {
                                    task.tabs[i] = "http" + task.tabs[i];
                                }
                            }
                            $("#" + task.kind).tasksListAddTask(task, true);
                        }
                    }
                }
            }

            // Now init all states from data
            $(TASKS_LIST_SELECTOR).each(function () {
                const $label = $(this).prev();
                setRadioStates($label.data(OPENTASK_DATA), $label);
                setJumpToFirstCheckState($label.data(JUMPTOFIRST_DATA), $label);
            });
        }
    });

    // Misc UI configuration
    $(TASKS_LIST_SELECTOR).each(function () {
        const $tasks = $(this);
        // Disable selection //
        $tasks.disableSelection().css("cursor", "default");
        $tasks.sortable({
            connectWith: TASKS_LIST_SELECTOR,
            dropOnEmpty: true,
            update: function () {
                saveExtensionData();
            }
        });
    });
    $("#taskContextMenu").disableSelection().css("cursor", "default");

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //// jQueryUI behaviors
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    // Autosearch ------------------------------------------------------------------------------------------------------
    $("#input-add").on("input", function () {
        const matchString = $("#input-add").val().trim().toLocaleLowerCase();
        console.debug(`searching for: ${matchString}`);
        if (matchString.length < 1) {
            $(TASK_SELECTOR).each(function () {
                $(this).taskShow();
            });
            $("#searchinput").popover("hide");
        } else {
            $(TASK_SELECTOR + " .title").each(function () {
                if ($(this).parent().hasClass("active")) {
                    $(this).parent().taskShow();
                } else {
                    if ($(this).text().toLocaleLowerCase().indexOf(matchString) !== -1) {
                        $(this).parent().taskShow();
                    } else {
                        $(this).parent().taskHide();
                    }
                }
            });
            $("#searchinput").popover("show");
        }
    });

    /**
     * Handle special keys ESC and ENTER on search box
     */
    $("#input-add").keydown(function (event) {
        if (event.keyCode === KEYCODE_ENTER) {
            const $task = addTaskFromInput();
            $task.trigger("dblclick");
        }
        // Clear input on ESC or after ENTER has created a new task
        if ((event.keyCode === KEYCODE_ENTER) || (event.keyCode === KEYCODE_ESCAPE)) {
            $("#input-add").val("");
            $(TASK_SELECTOR).each(function () {
                $(this).taskShow();
            });
            $("#searchinput").popover("hide");

            return false;
        }
    });

    /**
     * Init all jQueryUI popovers
     */
    $(function () {
        $('[data-toggle="popover"]').popover();
    });


    /**
     * Create a new task with current input text as task label.
     */
    function addTaskFromInput() {
        const $inputadd = $("#input-add");
        const text = dedupTaskNames($inputadd.val());
        console.info(`Creating task: ${text}`);
        return $("#T").tasksListAddTask({
            label: text,
            tabs: ["chrome://newtab"]
        });
    }

    // Button ADD ------------------------------------------------------------------------------------------------------
    $("#btn-add").on("click", function (event) {
        addTaskFromInput();
        return false;
    });

    // Advanced buttons re:JSON ----------------------------------------------------------------------------------------
    $("#btn-show-data").on("click", function (event) {
        $("#jsontext").val(JSON.stringify(getFlattenedTasksDict()));
    });


    $("#btn-save-data").on("click", function (event) {
        const json = JSON.parse($("#jsontext").val());

        if (window.confirm("WARNING! This will overwrite all tasks and their tabs by the data in the box below. Proceed?")) {
            // Save it using the Chrome extension storage API.
            console.info("Saving tabs", json);
            chrome.storage.sync.clear();
            chrome.storage.sync.set(json,
                function () {
                    if (chrome.runtime.lastError) {
                        console.error("Error while saving tabs:", chrome.runtime.lastError);
                    } else {
                        console.debug("Tabs saved");
                    }

                    // check
                    window.location.reload();
                });
        }
    });

    // Popup task context menu -----------------------------------------------------------------------------------------

    /**
     * Utility function: common skeleton to process one of task context menu actions
     * @param event the context menu action click event
     * @param action {!function} a function that executes the action
     * @return {boolean} true to cancel event bubble
     */
    function processTaskContextMenu(event, action) {
        const kind = $("#taskContextMenu").data(KIND_DATA);
        const index = $("#taskContextMenu").data(INDEX_DATA);
        const $task = $("#" + kind).find(TASK_SELECTOR).eq(index);
        console.assert($task.exists(), "Can't find clicked task?!?");
        if (action(index, $task)) {
            saveExtensionData();
        }
        return true;
    }

    /**
     * Delete a task context menu action.
     */
    $("#deleteTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            if ($task.hasClass("active")) {
                $task.taskCloseTabs();
            }
            console.info(`Deleting task: ${$task.taskGetLabel()} with ${$task.taskGetCount()} tabs.`);
            $task.taskGetList().tasksListRemoveTaskAt(index);
            return true;
        });
    });

    /**
     * Rename a task context menu action.
     */
    $("#renameTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            const name = window.prompt(chrome.i18n.getMessage("please_enter_new_label"), $task.taskGetLabel());
            if ((name === null) || (name === $task.taskGetLabel())) {
                return false;
            }
            $task.taskSetLabel(dedupTaskNames(name));
            return true;
        });
    });

    /**
     * Duplicate a task context menu action.
     */
    $("#duplicateTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            const newTask = $task.taskGetDefinition();
            newTask.label = dedupTaskNames(newTask.label);
            console.info({"Creating duplicate ": newTask.label, [KIND_DATA]: $task.taskGetKind()});
            $task.taskGetList().tasksListAddTask(newTask);
            return true;
        });
    });


    // Popup template context menu --------------------------------------------------------------------------------------
    $(document).click(function (e) {
        $("#taskContextMenu").hide();
    });

    $(LIST_LABEL_SELECTOR).on('show.bs.dropdown', function (e) {
        $("#taskContextMenu").hide();
    });


    // Tasks list context menu --------------------------------------------------------------------------------------
    $(".rename-row").on("click", null, function (event) {
        const $rowlabel = $(event.currentTarget).closest(LIST_LABEL_SELECTOR).find(".btn").first();
        $rowlabel.parent().dropdown('hide');
        const previousText = $rowlabel.text().trimRight();
        let name = window.prompt(chrome.i18n.getMessage("please_enter_new_label"), previousText);
        if (name === null) {
            return false;
        }
        name = name.trim();
        if (name === previousText) {
            return false;
        }
        $rowlabel.text(name + " ");
        saveExtensionData();
        return false;
    });

    $(".jump-to-first").on("click", function (event) {
        const $rowlabel = $(event.currentTarget).closest(LIST_LABEL_SELECTOR);
        const status = !$rowlabel.data(JUMPTOFIRST_DATA);
        setJumpToFirstCheckState(status, $rowlabel);
        saveExtensionData();
        return true;
    });

    $(".open-task").on("click", function (event) {
            const $rowlabel = $(event.currentTarget).closest(LIST_LABEL_SELECTOR);
            const isOpen = $rowlabel.data(OPENTASK_DATA);
            if (!isOpen) {
                setRadioStates(true, $rowlabel);
                saveExtensionData();
            }
            return true;
        }
    );
    $(".clone-task").on("click", function (event) {
            const $rowlabel = $(event.currentTarget).closest(LIST_LABEL_SELECTOR);
            const isOpen = $rowlabel.data(OPENTASK_DATA);
            if (isOpen) {
                setRadioStates(false, $rowlabel);
                saveExtensionData();
            }
            return true;
        }
    );
    $(LIST_LABEL_SELECTOR).on("hidden.bs.dropdown", function (event) {
        $(event.target).find("button").first().trigger("blur");
    });

    /**
     * Switch activation between two radio buttons
     * @param isOpenTask {!boolean} true to check open-task, false to check clone-task
     * @param $ancestor clicked item in DOM
     */
    function setRadioStates(isOpenTask, $ancestor) {
        const $rowLabel = $ancestor.closest(LIST_LABEL_SELECTOR);
        $rowLabel.data(OPENTASK_DATA, isOpenTask);
        const $openTaskRadio = $ancestor.find(".open-task span").first();
        const $cloneTaskRadio = $ancestor.find(".clone-task span").first();
        if (isOpenTask) {
            $openTaskRadio.removeClass("fa-circle-o");
            $openTaskRadio.addClass("fa-check-circle-o");
            $cloneTaskRadio.addClass("fa-circle-o");
            $cloneTaskRadio.removeClass("fa-check-circle-o");
        } else {
            $openTaskRadio.addClass("fa-circle-o");
            $openTaskRadio.removeClass("fa-check-circle-o");
            $cloneTaskRadio.removeClass("fa-circle-o");
            $cloneTaskRadio.addClass("fa-check-circle-o");
        }
    }

    /**
     * Switch jump-to-first checkbox state.
     * @param isJumpToFirst {!boolean} true to check, false to uncheck
     * @param $ancestor
     */
    function setJumpToFirstCheckState(isJumpToFirst, $ancestor) {
        const $rowLabel = $ancestor.closest(LIST_LABEL_SELECTOR);
        $rowLabel.data(JUMPTOFIRST_DATA, isJumpToFirst);
        const $jumpToFirstCheckbox = $ancestor.find(".jump-to-first span").first();
        if (isJumpToFirst) {
            $jumpToFirstCheckbox.removeClass("fa-square-o");
            $jumpToFirstCheckbox.addClass("fa-check-square-o");
        } else {
            $jumpToFirstCheckbox.addClass("fa-square-o");
            $jumpToFirstCheckbox.removeClass("fa-check-square-o");
        }
    }
});


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Translate UI
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function translate() {
    console.debug("Translation...");
    $("#input-add").attr("placeholder", chrome.i18n.getMessage("input_add_placeholder"));
    $("#renameTaskContextMenuLabel").text(chrome.i18n.getMessage("renameTaskContextMenu"));
    $("#duplicateTaskContextMenuLabel").text(chrome.i18n.getMessage("duplicateTaskContextMenu"));
    $("#deleteTaskContextMenuLabel").text(chrome.i18n.getMessage("deleteTaskContextMenu"));
    $("#cloneTemplateContextMenuLabel").text(chrome.i18n.getMessage("cloneTemplateContextMenu"));
    $(".i18n-jump-to-first").text(chrome.i18n.getMessage("jump_to_first"));
    $(".i18n-rename").text(chrome.i18n.getMessage("renameTaskContextMenu"));
    $(".i18n-clone-task").text(chrome.i18n.getMessage("clone_task"));
    $(".i18n-open-task").text(chrome.i18n.getMessage("open_task"));
}
