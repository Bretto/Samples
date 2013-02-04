angular.module('field-directive', ['input.html', 'textarea.html', 'select.html'])

.directive('field', function($compile, $http, $templateCache, $interpolate) {
  
  // Load a template, possibly from the $templateCache, and instantiate a DOM element from it
  function loadTemplate(template) {
    return $http.get(template, {cache:$templateCache}).then(function(response) {
      return angular.element(response.data);
    }, function(response) {
      throw new Error('Template not found: ' + template);
    });
  }

  // Find the "input" element in the template.  It will be one of input, select or textarea.
  // We need to ensure it is wrapped in jqLite\jQuery
  function findInputElement(templateElement) {
    return angular.element(templateElement.find('input')[0] || templateElement.find('select')[0] || templateElement.find('textarea')[0]);
  }

  function findLabelElement(templateElement) {
    return templateElement.find('label');
  }

  // Search through the originalDirective's element for elements that contain information about how to map
  // validation keys to messages
  function getValidationMessageMap(originalElement) {
      // Find all the <validator> child elements and extract their (key, message) info
      var validationMessages = {};
      angular.forEach(originalElement.find('validator'), function(element) {
        // Wrap the element in jqLite/jQuery
        element = angular.element(element);
        // Store the message info to be provided to the scope later
        // The content of the validation element may include interpolation {{}}
        // so we will actually store a function created by the $interpolate service
        // To get the interpolated message we will call this function with the scope. e.g.
        //   var messageString = getMessage(scope);
        validationMessages[element.attr('key')] = $interpolate(element.text());
      });
      return validationMessages;
  }

  // Find the content that will go into the new label
  // label="..." attribute trumps child <label> element
  function extractLabelContent(originalElement, attrs) {
      var labelContent = '';
      if ( attrs.fieldLabel ) {
        // Label is provided as an attribute on the originalElement
        labelContent = attrs.fieldLabel;
      } else if ( originalElement.find('label')[0] ) {
        // Label is provided as a <label> child element of the originalElement
        labelContent = originalElement.find('label').html();
      }
      if ( !labelContent ) {
        throw new Error('No label provided');
      }
      return labelContent;
  }

  return {
    restrict:'E',
    priority: 100,        // We need this directive to happen before ng-model
    terminal: true,       // We are going to deal with this element
    controller: function($scope) {
      // We will store the validation messages here, in the field's controller,
      // and the bind-validation-message directive will be able to access it
    },
    compile: function(element, attrs) {
      // Extract the label and validation message info from the directive's original element
      var messageMap = getValidationMessageMap(element);
      var labelContent = extractLabelContent(element, attrs);

      // Clear the directive's original element now that we have extracted what we need from it
      element.html('');

      return function (scope, element, attrs, fieldController) {
        // Attach a copy of the message map to this field's controller
        fieldController.messageMap = angular.copy(messageMap);

        // Load up the template for this kind of field
        var template = attrs.template || 'input.html';   // Default to the simple input if none given
        var getFieldElement = loadTemplate(template).then(function(newElement) {

          // Update the label's contents
          var labelElement = newElement.find('label');
          labelElement.html(labelContent);
          // Our template will have its own child scope
          var childScope = scope.$new();

          // Generate an id for the field from the ng-model expression and the current scope
          // We replace dots with underscores to work with browsers and ngModel lookup on the FormController
          // We couldn't do this in the compile function as we need to be able to calculate the unique id from the scope
          childScope.$fieldId = attrs.ngModel.replace('.', '_').toLowerCase() + '_' + childScope.$id;
          childScope.$fieldLabel = labelContent;

          // Copy over all left over attributes to the input element
          // We can't use interpolation in the template for directives such as ng-model
          var inputElement = findInputElement(newElement);
          angular.forEach(attrs.$attr, function (original, normalized) {
            switch ( normalized ) {
              case 'ngRepeat':
              case 'ngSwitch':
              case 'uiIf':
                throw new Error(normalized + ' directives are not supported on the same element as the field directive.');
              default:
              var value = element.attr(original);
              inputElement.attr(original, value);
              break;
            }
          });

          // Wire up the input (id and name) and its label (for).
          // We need to set the input element's name here before we compile the template.
          // If we leave it to be interpolated at the next $digest the formController doesn't pick it up
          inputElement.attr('name', childScope.$fieldId);
          inputElement.attr('id', childScope.$fieldId);
          newElement.find('label').attr('for', childScope.$fieldId);

          // We now compile and link our template here in the postLink function
          // This allows the ng-model directive on our template's <input> element to access the ngFormController
          $compile(newElement)(childScope);

          // Place our template as a child of the original element
          element.append(newElement);

          // Now that our template has been compiled and linked
          // we can access the <input> element's ngModelController
          childScope.$evalAsync(function(scope) {
            scope.$field = inputElement.controller('ngModel');
          });
        });
      };
    }
  };
})

// A directive to bind the interpolation function of a validation message to the content of an element
// use it as a attribute providing the validation key as the value of the attribute:
//   <span bind-validation-message="required"></span>
.directive('bindValidationMessage', function() {
  return {
    require: '^field',
    link: function(scope, element, attrs, fieldController) {
      var removeWatch = null;
      // The key may be dynamic (i.e. use interpolation) so we need to $observe it
      attrs.$observe('bindValidationMessage', function(key) {
        // Remove any previous $watch because the key has changed
        if ( removeWatch ) {
          removeWatch();
          removeWatch = null;
        }
        if ( key && fieldController.messageMap[key] ) {
          // Watch the message map interpolation function for this key
          removeWatch = scope.$watch(fieldController.messageMap[key], function(message) {
            // and update the contents of this element with the interpolated text
            element.html(message);
          });
        }
      });
    }
  };
});