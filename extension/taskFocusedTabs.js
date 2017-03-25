////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Utilities
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// What the Heck is that language and those libraries?!? :'-(
$.fn.exists = function () {
    return this.length > 0;
};

var extensionURL = chrome.extension.getURL("taskFocusedTabs.html");
function isTasksTab(tab) {
    "use strict";
    return tab.url.replace(/#*$/, "") === extensionURL;
}

function dedupTaskNames(text) {
    "use strict";
    if (!text.trim()) {
        text = "New task";
    }

    var tasksNames = $tasks.find("li .title").map(function () {
        return $(this).text();
    });
    if ($.inArray(text, tasksNames) >= 0) {
        var count = 1;
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

function getTasksAsArray($aTasksList, $aTemplateList) {
    "use strict";
    var reorderedFocus = {};
    var i = 0;
    $aTasksList.find("li").each(function () {
        reorderedFocus[i] = $(this).taskGetObject();
        reorderedFocus[i].kind = "T";
        i++;
    });
    $aTemplateList.find("li").each(function () {
        reorderedFocus[i] = $(this).taskGetObject();
        reorderedFocus[i].kind = "A";
        i++;
    });
    return reorderedFocus;
}

// Save Tasks ----------------------------------------------------------------------------------------------------------
function saveTasks() {
    "use strict";
    var tasksArray = getTasksAsArray($tasks, $templates);

    // Save it using the Chrome extension storage API.
    console.log("Saving tabs", tasksArray);

    chrome.storage.sync.set(
        tasksArray,
        function () {
            if (chrome.runtime.lastError) {
                console.error("Error while saving tabs", chrome.runtime.lastError);
            } else {
                console.log("Tabs saved");
            }
        });
    // Saving will not remove past entries
    chrome.storage.sync.remove(
        Object.keys(tasksArray).length.toString(),
        function () {
            if (chrome.runtime.lastError) {
                console.debug("No entry to delete", chrome.runtime.lastError);
            } else {
                console.log("Removed template");
            }
        });
}

/*
 chrome.storage.onChanged.addListener(function (changes, namespace) {
 for (key in changes) {
 var storageChange = changes[key];
 console.log('Storage key "%s" in namespace "%s" changed. ' +
 'Old value was "%s", new value is "%s".',
 key,
 namespace,
 storageChange.oldValue ? storageChange.oldValue.label : "-removed",
 storageChange.newValue ? storageChange.newValue.label : "-removed-");
 }
 });
 */

function focusTabsRefresh(urls, isAllComplete) {
    try {
        var $selectedTask = $tasks.find("li.active");
        if (!$selectedTask.exists()) {
            console.debug("No task currently active", $selectedTask);
            return;
        }

        if ($selectedTask.css("fontStyle") == "italic") {
            if (isAllComplete) {
                $selectedTask.css("fontStyle", "normal");
                console.debug("All tabs load completed");
                // and continue...
            } else {
                // We are still loading after a task switch. Too soon!
                console.debug("We are still loading after a task switch ; too soon to update tasks");
                return;
            }
        }

        var index = $selectedTask.find(".title").text();
        var _focusdirty_ = true; //FIXME
        if (_focusdirty_) {
            console.log("Updating tabs for task: " + index);
            // FIXME ?
            //_focus_[index] = urls;
            $.data($selectedTask.get(0), "tabs", urls);
            $selectedTask.find(".badge").html(urls.length);

            // Save it using the Chrome extension storage API.
            saveTasks();
        }
    } catch (e) {
        console.error("Error in focusTabsRefresh", e);
    }
}

function moveTabOutOfTask(aTab) {
    console.log("Moving new tab " + aTab.tabId + " out of active task tabs: ", aTab);

    chrome.tabs.query({
        currentWindow: true
    }, function (tabs) {
        try {
            for (var tab of tabs) {
                if (isTasksTab(tab)) {
                    chrome.tabs.move(aTab.id, {
                        index: tab.index
                    }, function (tabs) {
                    });
                }
            }
        } catch (e) {
            console.error("Error while preserving new tab", e);
        }
    });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Task kinda-class
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
$.fn.taskGetLabel = function () {
    "use strict";
    return this.find(".title").text();
};
$.fn.taskGetCount = function () {
    "use strict";
    return parseInt(this.find(".badge").text());
};
$.fn.taskSetLabel = function (aLabel) {
    "use strict";
    return this.find(".title").text(aLabel);
};
$.fn.taskGetObject = function (aKind) {
    "use strict";
    return {label: this.find(".title").text(), kind: aKind, tabs: this.data("tabs")};
};

function closeTaskTabs($previous) {
    $previous.removeClass("active"); // previous list-item

    chrome.tabs.query({
        currentWindow: true
    }, function (tabs) {
        try {
            var taskFocusedTabsTab = null;
            var tabsToRemove = [];
            for (var tab of tabs) {
                if (taskFocusedTabsTab == null) {
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
        } finally {
        }
    });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// TasksList kinda-class
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function addBtn(aTask, atFirstPosition) {
    atFirstPosition = atFirstPosition || false;

    var count = aTask.tabs.length;
    var text = aTask.label;

    var $btn = $("<li type='button' class='list-group-item'><span class='badge'>" + count + "</span><span class='title'>" + text + "</span></li>");
    if (atFirstPosition) {
        $btn.prependTo("#tasks");
    }
    else {
        $btn.appendTo("#tasks");
    }

    $btn.data("tabs", aTask.tabs);
    $btn.on("dblclick", null, {
        "index": text
    }, function (event) {
        //$tasks.tasksListActivateTask($(this));
        var $task = $(this);

        // Close tabs of previously selected task
        var $previous = $tasks.children(".active")
        if ($previous.exists()) {
            closeTaskTabs($previous);

            if ($previous.is($task)) {
                $previous.css("fontStyle", "normal");
                return;
            }
        }

        // Jump first?
        var jumpToFirstOnActivation = true;
        if (jumpToFirstOnActivation) {
            $task.prependTo("#tasks");
        }

        // Now open all tabs of selected task
        var index = $task.index();
        var tabs = $task.data("tabs");
        if (tabs.length > 0) {
            $task.css("fontStyle", "italic");
        }
        console.log("Opening " + tabs.length + " tabs for task " + index + ": " + $task.taskGetLabel());

        var recursiveOpenTabs = function (remainingUrlsArray, $aTask) {
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
        $templateContextMenu.hide();

        $taskContextMenu.css({
            display: "block",
            left: event.pageX,
            top: event.pageY
        });
        console.debug("Context menu on task " + $(event.currentTarget).index());
        $taskContextMenu.data("target", $(event.currentTarget).index());
        return false;
    });
}

$.fn.tasksListRemoveTaskAt = function (aTaskIndex) {
    "use strict";
    this.find("li").eq(aTaskIndex).remove();
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Templates kinda-class
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

$.fn.templatesAddTask = function (aTask, atFirstPosition) {
    atFirstPosition = atFirstPosition || false;

    var count = aTask.tabs.length;
    var text = aTask.label;

    var $btn = $("<li type='button' class='list-group-item Template'><span class='badge'>" + count + "</span><span class='title'>" + text + "</span></li>");
    if (atFirstPosition) {
        $btn.prependTo("#templates");
    }
    else {
        $btn.appendTo("#templates");
    }

    $btn.data("tabs", aTask.tabs);
    $btn.on("dblclick", null, {
        "index": text
    }, function (event) {
        var index = $(event.currentTarget).index();
        console.debug("dblClick on task " + index);
        var $template = $templates.find("li").eq(index);
        console.log("Cloning task from template: " + $template.taskGetLabel());
        addBtn($template.taskGetObject(), true);
        saveTasks();
        return false;
    });

    // Popup template context menu
    $btn.on("contextmenu", null, function (event) {
        var index = $(event.currentTarget).index();
        console.debug("Context menu on task " + index);
        $taskContextMenu.hide();
        $templateContextMenu.css({
            display: "block",
            left: event.pageX,
            top: event.pageY
        });
        $templateContextMenu.data("target", index);
        return false;
    });
};


function init() {
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Init & jQueryUI setup
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
$(function () {
    console.debug("INIT");

    translate();

    chrome.storage.sync.get(null, function (items) {
        if (chrome.runtime.lastError) {
            console.error("Error while reading tasks from storage:", chrome.runtime.lastError);
            //FIXME ERROR INSTEAD
        } else {
            console.log("Read tasks from storage: ", items);
            for (var index in items) {
                var task = items[index];
                if (task.kind == "T") {
                    addBtn(task);
                }
                else {
                    $templates.templatesAddTask(task);
                }
            }
        }
    });

    $tasks = $("#tasks");
    $templates = $("#templates");
    $taskContextMenu = $("#taskContextMenu");
    $templateContextMenu = $("#templateContextMenu");

    // Disable selection //
    $tasks.disableSelection().css("cursor", "default");
    $tasks.sortable({
        update: function (event, ui) {
            saveTasks();
        }
    });
    $templates.disableSelection().css("cursor", "default");
    $taskContextMenu.disableSelection().css("cursor", "default");
    $templateContextMenu.disableSelection().css("cursor", "default");


    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //// jQueryUI behaviors
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    // Autosearch ------------------------------------------------------------------------------------------------------
    $("#input-add").on("input", function () {
        "use strict";
        var matchString = $("#input-add").val().trim().toLocaleLowerCase();
        console.debug("matchString:" + matchString);
        if (matchString.length < 2) {
            $tasks.find("li").each(function () {
                $(this).show();
            });
            $templates.find("li").each(function () {
                $(this).show();
            });

        }
        else {
            var tasksMatching = $tasks.find("li .title").each(function () {
                if ($(this).parent().hasClass("active")) {
                    $(this).parent().show();
                }
                else {
                    if ($(this).text().toLocaleLowerCase().indexOf(matchString) != -1) {
                        $(this).parent().show();
                    }
                    else {
                        $(this).parent().hide();
                    }
                }
            });
            var tasksMatching = $templates.find("li .title").each(function () {
                if ($(this).text().toLocaleLowerCase().indexOf(matchString) != -1) {
                    $(this).parent().show();
                }
                else {
                    $(this).parent().hide();
                }
            });
        }
    });
    $("#input-add").keydown(function (event) {
        "use strict";
        console.debug(event);
        if (event.keyCode == 27) { // escape key maps to keycode `27`
            $("#input-add").val("");
            $("#input-add").trigger("input");
        }
    });

    // Button ADD ------------------------------------------------------------------------------------------------------
    $("#btn-add").on("click", function (event) {
        var $inputadd = $("#input-add");
        var text = dedupTaskNames($inputadd.val());

        addBtn({
            label: text,
            tabs: ["chrome://newtab"]
        }, true);

        $inputadd.val("");
        $inputadd.trigger("input");
    });

    // Advanced buttons re:JSON ----------------------------------------------------------------------------------------
    $("#btn-show-data").on("click", function (event) {
        $("#jsontext").val(JSON.stringify(getTasksAsArray($tasks, $templates)));
    });

    $("#btn-save-data").on("click", function (event) {
        var json = JSON.parse($("#jsontext").val());

        if (confirm("WARNING! This will overwrite all tasks and their tabs by the data in the box below. Proceed?")) {
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
        var index = $taskContextMenu.data("target");
        var $task = $tasks.find("li").eq(index);
        if (action(index, $task)) {
            saveTasks();
        }
        return true;
    }


    $("#deleteTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            "use strict";
            if ($task.hasClass("active")) {
                closeTaskTabs($task);
            }
            var count = $task.taskGetCount();
            console.log("Deleting task that had " + count + " tabs");
            $tasks.tasksListRemoveTaskAt(index);
            return true;
        });
    });

    $("#templateTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            "use strict";
            if ($task.hasClass("active")) {
                closeTaskTabs($task);
            }
            console.log("Templating task", $task);
            $templates.templatesAddTask($task.taskGetObject(), true);
            $tasks.tasksListRemoveTaskAt(index);
            return true;
        });
    });

    $("#renameTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            "use strict";
            var name = prompt("Please enter new label", $task.taskGetLabel());
            if (name == null)
                return false;
            $task.taskSetLabel(dedupTaskNames(name));
            return true;
        });
    });

    $("#duplicateTaskContextMenu").on("click", null, function (event) {
        return processTaskContextMenu(event, function (index, $task) {
            "use strict";
            var task = $task.taskGetObject();
            task.label = dedupTaskNames(task.label);
            addBtn(task, true);
            return true;
        });
    });


    // Popup template context menu --------------------------------------------------------------------------------------
    $(document).click(function (e) {
        $taskContextMenu.hide();
        $templateContextMenu.hide();
    });

    function processTemplateContextMenu(event, action) {
        var index = $templateContextMenu.data("target");
        var $template = $templates.find("li").eq(index);
        if (action(index, $template)) {
            saveTasks();
        }
        return true;
    }

    $("#cloneTemplateContextMenu").on("click", null, function (event) {
        return processTemplateContextMenu(event, function (index, $template) {
            "use strict";
            console.log("Cloning task from templates: " + $template.taskGetLabel());
            var task = $template.taskGetObject();
            task.label = dedupTaskNames(task.label);
            addBtn(task, true);
            return true;
        });
    });

    $("#deleteTemplateContextMenu").on("click", null, function (event) {
        return processTemplateContextMenu(event, function (index, $template) {
            "use strict";
            console.log("Deleting task from templates: " + $template.taskGetLabel());
            $templates.tasksListRemoveTaskAt(index);
            return true;
        });
    });
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Translate UI
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function translate() {
    console.debug("Translation");
    $("#input-add").attr("placeholder", chrome.i18n.getMessage("input_add_placeholder"));
    $("#TasksLabel").text(chrome.i18n.getMessage("TasksLabel"));
    $("#TemplatesLabel").text(chrome.i18n.getMessage("TemplatesLabel"));
    $("#renameTaskContextMenuLabel").text(chrome.i18n.getMessage("renameTaskContextMenu"));
    $("#duplicateTaskContextMenuLabel").text(chrome.i18n.getMessage("duplicateTaskContextMenu"));
    $("#templateTaskContextMenuLabel").text(chrome.i18n.getMessage("templateTaskContextMenu"));
    $("#deleteTaskContextMenuLabel").text(chrome.i18n.getMessage("deleteTaskContextMenu"));
    $("#cloneTemplateContextMenuLabel").text(chrome.i18n.getMessage("cloneTemplateContextMenu"));
    $("#deleteTemplateContextMenuLabel").text(chrome.i18n.getMessage("deleteTemplateContextMenu"));
}