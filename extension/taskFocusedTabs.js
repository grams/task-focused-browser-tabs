////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Utilities
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/* globals chrome, console, $, this */
/* jshint esversion:6 */
"use strict";

// Not a JavaScript fan and it shows
$.fn.exists = function () {
    return this.length > 0;
};

const extensionURL = chrome.extension.getURL("taskFocusedTabs.html");

function isTasksTab(tab) {
    return tab.url.replace(/#*$/, "") === extensionURL;
}

function dedupTaskNames(text) {
    if (!text.trim()) {
        text = chrome.i18n.getMessage("new_task");
    }

    const tasksNames = [];
    $("li.task").each(function () {
        tasksNames.push($(this).taskGetLabel());
    });

    if ($.inArray(text, tasksNames) >= 0) {
        let count = 1;
        while ($.inArray(text + " (" + count + ")", tasksNames) >= 0) {
            count++;
            // Sanity check
            if (count > 99) {
                return;
            }
        }
        text = text + " (" + count + ")";
    }
    return text;
}

/**
 * One may wonder why such a convoluted way of storing data in google sync.
 * The straightforward approach who be a single tree-like structure in a single key-value pair, but this approach fails
 * because of the (small actually) limit on the size of a value.
 * The solution is to turn the structure into a very flat list of key-values, using a counter for keys and objects as
 * values.
 */
function getFlattenedTasksDict() {
    const flattenedMap = {};
    let i = 0;
    $("li.task").each(function () {
        const aTask = $(this).taskGetObject();
        aTask.kind = $(this).taskGetKind(); //FIXME
        flattenedMap[i++] = aTask;
    });

    // Now hide config within tasks
    flattenedMap[i++] = {
        label: '__config__',
        kind: '_',
        tabs: [
            $('#TLabel .btn').text().trim(),
            $('#ALabel .btn').text().trim(),
            $('#SLabel .btn').text().trim(),
            $('#KLabel .btn').text().trim()
        ]
    };

    return flattenedMap;
}

// Save Tasks ----------------------------------------------------------------------------------------------------------
function saveTasks() {
    const tasksArray = getFlattenedTasksDict();

    // Save it using the Chrome extension storage API.
    console.debug("Saving tabs data...", tasksArray);

    chrome.storage.sync.set(
        tasksArray,
        function () {
            if (chrome.runtime.lastError) {
                console.error("Error while saving tabs: " + chrome.runtime.lastError.message, chrome.runtime.lastError);
            } else {
                console.info("Tabs data saved.");
            }
        });
    // Saving will not remove past entries
    chrome.storage.sync.remove(
        Object.keys(tasksArray).length.toString(),
        function () {
            if (chrome.runtime.lastError) {
                console.debug("No entry to delete: " + chrome.runtime.lastError.message, chrome.runtime.lastError);
            } else {
                console.debug("Removed last past entry.");
            }
        });
}

function focusTabsRefresh(urls, isAllComplete) {
    try {
        const $selectedTask = $("li.task.active").first();
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

        const index = $selectedTask.find(".title").text();
        let _focusdirty_ = true; //FIXME
        if (_focusdirty_) {
            console.log("Updating tabs data for task: " + index);
            // FIXME ?
            //_focus_[index] = urls;
            $.data($selectedTask.get(0), "tabs", urls);
            $selectedTask.find(".badge").html(urls.length);

            // Save it using the Chrome extension storage API.
            saveTasks();
        }
    } catch (e) {
        console.error("Error in focusTabsRefresh!", e);
    }
}

function moveTabOutOfTask(aTab) {
    console.info("Moving new tab " + aTab.tabId + " out of active task tabs: ", aTab);

    chrome.tabs.query({
        currentWindow: true
    }, function (tabs) {
        try {
            for (const tab of tabs) {
                if (isTasksTab(tab)) {
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
//// Task kinda-class
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
$.fn.taskGetLabel = function () {
    return this.find(".title").text();
};
$.fn.taskGetCount = function () {
    return parseInt(this.find(".badge").text());
};
$.fn.taskSetLabel = function (aLabel) {
    return this.find(".title").text(aLabel);
};
$.fn.taskGetObject = function (aKind) {
    return {label: this.find(".title").text(), kind: aKind, tabs: this.data("tabs")};
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


function closeTaskTabs($previous) {
    console.debug("Closing tabs for task " + $previous.taskGetLabel());
    $previous.removeClass("active"); // previous list-item

    chrome.tabs.query({
        currentWindow: true
    }, function (tabs) {
        try {
            let taskFocusedTabsTab = null;
            const tabsToRemove = [];
            for (const tab of tabs) {
                if (taskFocusedTabsTab === null) {
                    if (isTasksTab(tab)) {
                        taskFocusedTabsTab = tab;
                    }
                } else {
                    tabsToRemove.push(tab.id);
                }
            }

            chrome.tabs.remove(tabsToRemove, function () {
            });
        } catch (e) {
            console.error("Error while removing tabs", e);
        }
    });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// TasksList kinda-class
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function addBtn(aTask, kind, atFirstPosition) {
    if (!kind) {
        return;
    }

    atFirstPosition = atFirstPosition || false;

    const count = aTask.tabs.length;
    const text = aTask.label;

    const $btn = $("<li type='button' class='task list-group-item list-group-item-action d-flex justify-content-between align-items-center'><span class='title'>" + text + "</span><span class='badge badge-secondary badge-pill'>" + count + "</span></li>");
    if (atFirstPosition) {
        $btn.prependTo($("#" + kind));
    } else {
        $btn.appendTo($("#" + kind));
    }

    $btn.data("tabs", aTask.tabs);
    $btn.on("dblclick", null, {
        "index": text
    }, function (event) {
        const $task = $(this);

        // Close tabs of previously selected task
        console.debug("Double-click on task " + $task.taskGetLabel());
        const $previous = $("li.task.active").first();
        if ($previous.exists()) {
            closeTaskTabs($previous);

            if ($previous.is($task)) {
                $previous.css("fontStyle", "normal");
                return;
            }
        }

        // Jump first?
        const jumpToFirstOnActivation = true;
        if (jumpToFirstOnActivation) {
            $task.prependTo($task.parent());
        }

        // Now open all tabs of selected task
        const index = $task.index();
        const tabs = $task.data("tabs");
        if (tabs.length > 0) {
            $task.css("fontStyle", "italic");
        }
        console.debug("Opening " + tabs.length + " tabs for task " + index + ": " + $task.taskGetLabel());

        const recursiveOpenTabs = function (remainingUrlsArray, $aTask) {
            if (remainingUrlsArray.length === 0) {
                $aTask.addClass("active"); // activated list-item
            } else {
                chrome.tabs.create({
                    active: false,
                    url: remainingUrlsArray[0]
                }, function (tab) {
                    recursiveOpenTabs(remainingUrlsArray.slice(1), $aTask);
                });
            }
        };
        recursiveOpenTabs(tabs, $task);
    });

    // Popup task context menu
    $btn.on("contextmenu", null, function (event) {
        $("#taskContextMenu").css({
            display: "block",
            left: event.pageX,
            top: event.pageY
        });
        console.debug("Context menu on task: " + $(event.currentTarget).taskGetLabel());
        $(".list-label.show").dropdown('hide');
        $("#taskContextMenu").data({
            "kind": $(event.currentTarget).taskGetKind(),
            "index": $(event.currentTarget).index()
        });
        return false;
    });
}

$.fn.tasksListRemoveTaskAt = function (aTaskIndex) {
    this.find("li").eq(aTaskIndex).remove();
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Init & jQueryUI setup
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
$(function () {
    translate();

    chrome.storage.sync.get(null, function (items) {
        if (chrome.runtime.lastError) {
            console.error("Error while reading tasks from storage: " + chrome.runtime.lastError.message, chrome.runtime.lastError);
            //FIXME ALERT ERROR INSTEAD
        } else {
            console.info("Read tasks from storage: ", items);
            for (let index in items) {
                if (items.hasOwnProperty(index)) { // I miss Python
                    const task = items[index];
                    if ("_" === task.kind) {
                        // Yeah some config here, not tasks
                        if (task.tabs.length > 3) {
                            $('#TLabel .btn').text(task.tabs[0] + " ");
                            $('#ALabel .btn').text(task.tabs[1] + " ");
                            $('#SLabel .btn').text(task.tabs[2] + " ");
                            $('#KLabel .btn').text(task.tabs[3] + " ");
                        }
                    } else {
                        addBtn(task, task.kind);
                    }
                }
            }
            // Default values
            if (!$('#TLabel').text()) {
                const defaultLabel = chrome.i18n.getMessage("TasksLabel");
                $('.list-label').each(function () {
                    $(this).text(defaultLabel);
                });
            }
        }
    });

    $(".tasks-list").each(function () {
        const $tasks = $(this);
        // Disable selection //
        $tasks.disableSelection().css("cursor", "default");
        $tasks.sortable({
            connectWith: ".tasks-list",
            dropOnEmpty: true,
            update: function (event, ui) {
                saveTasks();
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
        console.debug("searching for:" + matchString);
        if (matchString.length < 1) {
            $("li.task").each(function () {
                $(this).taskShow();
            });
        } else {
            $("li.task .title").each(function () {
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
        }
    });
    $("#input-add").keydown(function (event) {
        if (event.keyCode === 27) { // escape key
            $("#input-add").val("");
            $("li.task").each(function () {
                $(this).taskShow();
            });
        }
        if (event.keyCode === 13) { // enter key
            addTaskFromInput();
            return false;
        }
    });

    function addTaskFromInput() {
        const $inputadd = $("#input-add");
        const text = dedupTaskNames($inputadd.val());

        console.info("Creating task: " + text);
        addBtn({
            label: text,
            tabs: ["chrome://newtab"]
        }, "T", true);

        $inputadd.val("");
        $("li.task").each(function () {
            $(this).taskShow();
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
                        console.log("Tabs saved");
                    }

                    // check
                    location.reload();
                });
        }
    });

    // Popup task context menu -----------------------------------------------------------------------------------------
    function processTaskContextMenu(event, action) {
        const kind = $("#taskContextMenu").data("kind");
        const index = $("#taskContextMenu").data("index");
        const $task = $("#" + kind).find("li.task").eq(index).first();
        console.assert($task.exists(), "Can't find clicked task?!?");
        if (action(index, $task)) {
            saveTasks();
        }
        return true;
    }


    $("#deleteTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            if ($task.hasClass("active")) {
                closeTaskTabs($task);
            }
            console.info("Deleting task: " + $task.taskGetLabel() + " with " + $task.taskGetCount() + " tabs.");
            console.debug(index);
            $task.parent().tasksListRemoveTaskAt(index);
            return true;
        });
    });

    $("#renameTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            const name = window.prompt(chrome.i18n.getMessage("please_enter_new_label"), $task.taskGetLabel());
            if (name === null) {
                return false;
            }
            if (name === $task.taskGetLabel()) {
                return false;
            }
            $task.taskSetLabel(dedupTaskNames(name));
            return true;
        });
    });

    $("#duplicateTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            const task = $task.taskGetObject();
            task.label = dedupTaskNames(task.label);
            console.info({"Creating duplicate ": task.label, "kind": $task.taskGetKind()});
            addBtn(task, $task.taskGetKind(), true);
            return true;
        });
    });


    // Popup template context menu --------------------------------------------------------------------------------------
    $(document).click(function (e) {
        $("#taskContextMenu").hide();
    });

    $(".list-label").on('show.bs.dropdown', function (e) {
        $("#taskContextMenu").hide();
    });


    /*
        $("#cloneTemplateContextMenu").on("click", null, function (event) {
            return processTemplateContextMenu(event, function (index, $template) {
                console.log("Cloning task from templates: " + $template.taskGetLabel());
                const task = $template.taskGetObject();
                task.label = dedupTaskNames(task.label);
                addBtn(task, "T", true);
                return true;
            });
        });

     */

    // Row label context menu --------------------------------------------------------------------------------------
    $(".rename-row").on("click", null, function (event) {
        const $rowlabel = $(event.currentTarget).closest(".list-label").find(".btn").first();
        $rowlabel.parent().dropdown('hide');
        const previousText = $rowlabel.text().trimRight()
        var name = window.prompt(chrome.i18n.getMessage("please_enter_new_label"), previousText);
        if (name === null) {
            return false;
        }
        name = name.trim();
        if (name === previousText) {
            return false;
        }
        $rowlabel.text(name + " ");
        saveTasks();
        return false;
    });

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
}