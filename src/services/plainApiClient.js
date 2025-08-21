const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Plain API Client
 * 
 * This service handles all interactions with the Plain GraphQL API
 * for updating thread labels and other operations.
 */
class PlainApiClient {
  constructor() {
    this.apiUrl = config.plainApiUrl;
    this.apiToken = config.plainApiToken;
    
    // Create axios instance with default headers
    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`
      },
      timeout: 15000 // 15 second timeout
    });

    // Add request/response interceptors for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('Plain API request', {
          method: config.method,
          url: config.url,
          operationName: config.data?.operationName
        });
        return config;
      },
      (error) => {
        logger.error('Plain API request error', { error: error.message });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Plain API response', {
          status: response.status,
          operationName: response.config.data ? JSON.parse(response.config.data).operationName : null
        });
        return response;
      },
      (error) => {
        // Enhanced error logging for GraphQL debugging
        const errorDetails = {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data,
          headers: error.response?.headers,
          requestData: error.config?.data ? JSON.parse(error.config.data) : null,
          url: error.config?.url,
          method: error.config?.method
        };
        
        logger.error('Plain API response error - DETAILED', errorDetails);
        
        // Log GraphQL-specific errors
        if (error.response?.data?.errors) {
          logger.error('GraphQL errors from Plain API', {
            errors: error.response.data.errors,
            query: errorDetails.requestData?.query,
            variables: errorDetails.requestData?.variables
          });
        }
        
        return Promise.reject(error);
      }
    );
  }

  /**
   * Execute a GraphQL query or mutation
   * @param {string} query - GraphQL query/mutation string
   * @param {Object} variables - Query variables
   * @param {string} operationName - Operation name for tracking
   * @returns {Promise<Object>} GraphQL response data
   */
  async executeGraphQL(query, variables = {}, operationName = null) {
    try {
      const response = await this.client.post('', {
        query,
        variables,
        operationName
      });

      if (response.data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data.data;
    } catch (error) {
      logger.error('GraphQL execution failed', {
        operationName,
        error: error.message,
        variables
      });
      throw error;
    }
  }

  /**
   * Add a priority label to a thread
   * @param {string} threadId - Plain thread ID
   * @param {string} priority - Priority level (P0, P1, P2, P3)
   * @returns {Promise<Object>} Updated thread data
   */
  async addPriorityLabel(threadId, priority) {
    const labelTypeId = config.priorityLabels[priority];
    
    if (!labelTypeId) {
      throw new Error(`No label type ID configured for priority: ${priority}`);
    }

    logger.info('Adding priority label to thread', {
      threadId,
      priority,
      labelTypeId
    });

    const mutation = `
      mutation AddLabels($threadId: ID!, $labelTypeIds: [ID!]!) {
        addLabels(threadId: $threadId, labelTypeIds: $labelTypeIds) {
          ... on AddLabelsSuccess {
            thread {
              id
              title
              labels {
                id
                labelType {
                  id
                  name
                  icon
                }
              }
            }
          }
          ... on MutationError {
            message
            type
            code
            fields {
              field
              message
              type
            }
          }
        }
      }
    `;

    const variables = {
      threadId,
      labelTypeIds: [labelTypeId]
    };

    try {
      const data = await this.executeGraphQL(mutation, variables, 'AddLabels');
      
      if (data.addLabels.message) {
        throw new Error(`Failed to add label: ${data.addLabels.message}`);
      }

      logger.info('Successfully added priority label', {
        threadId,
        priority,
        labelTypeId,
        labelsCount: data.addLabels.thread.labels.length
      });

      return data.addLabels.thread;
    } catch (error) {
      logger.error('Failed to add priority label', {
        threadId,
        priority,
        labelTypeId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Remove a priority label from a thread
   * @param {string} threadId - Plain thread ID
   * @param {string} labelId - Specific label ID to remove
   * @returns {Promise<Object>} Updated thread data
   */
  async removePriorityLabel(threadId, labelId) {
    logger.info('Removing priority label from thread', {
      threadId,
      labelId
    });

    const mutation = `
      mutation RemoveLabels($threadId: ID!, $labelIds: [ID!]!) {
        removeLabels(threadId: $threadId, labelIds: $labelIds) {
          ... on RemoveLabelsSuccess {
            thread {
              id
              title
              labels {
                id
                labelType {
                  id
                  name
                  icon
                }
              }
            }
          }
          ... on MutationError {
            message
            type
            code
            fields {
              field
              message
              type
            }
          }
        }
      }
    `;

    const variables = {
      threadId,
      labelIds: [labelId]
    };

    try {
      const data = await this.executeGraphQL(mutation, variables, 'RemoveLabels');
      
      if (data.removeLabels.message) {
        throw new Error(`Failed to remove label: ${data.removeLabels.message}`);
      }

      logger.info('Successfully removed priority label', {
        threadId,
        labelId,
        labelsCount: data.removeLabels.thread.labels.length
      });

      return data.removeLabels.thread;
    } catch (error) {
      logger.error('Failed to remove priority label', {
        threadId,
        labelId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get thread details including current labels
   * @param {string} threadId - Plain thread ID
   * @returns {Promise<Object>} Thread data
   */
  async getThread(threadId) {
    logger.debug('Fetching thread details', { threadId });

    const query = `
      query GetThread($threadId: ID!) {
        thread(threadId: $threadId) {
          id
          title
          createdAt {
            iso8601
          }
          updatedAt {
            iso8601
          }
          tier {
            name
          }
          status
          priority
          customer {
            id
            email {
              email
            }
            fullName
            externalId
          }
          labels {
            id
            labelType {
              id
              name
              icon
            }
          }
          firstMessage {
            id
            content
            textContent
          }
        }
      }
    `;

    const variables = { threadId };

    try {
      logger.debug('Executing GetThread query', {
        threadId,
        query: query.replace(/\s+/g, ' ').trim(),
        variables
      });

      const data = await this.executeGraphQL(query, variables, 'GetThread');
      
      if (!data.thread) {
        throw new Error(`Thread not found: ${threadId}`);
      }

      logger.debug('Successfully fetched thread', {
        threadId,
        title: data.thread.title,
        labelsCount: data.thread.labels?.length || 0,
        tierName: data.thread.tier?.name
      });

      // Add enhanced content for classification
      const enhancedThread = {
        ...data.thread,
        allMessageContent: data.thread.firstMessage?.textContent || data.thread.firstMessage?.content || ''
      };

      return enhancedThread;
    } catch (error) {
      logger.error('Failed to fetch thread - DETAILED ERROR', {
        threadId,
        error: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status,
        query: query.replace(/\s+/g, ' ').trim(),
        variables
      });
      throw error;
    }
  }

  /**
   * Get customer details
   * @param {string} customerId - Plain customer ID
   * @returns {Promise<Object>} Customer data
   */
  async getCustomer(customerId) {
    logger.debug('Fetching customer details', { customerId });

    const query = `
      query GetCustomer($customerId: ID!) {
        customer(customerId: $customerId) {
          id
          email
          fullName
          externalId
          updatedAt {
            iso8601
          }
          customerGroupMemberships {
            customerGroup {
              id
              name
              key
            }
          }
        }
      }
    `;

    const variables = { customerId };

    try {
      const data = await this.executeGraphQL(query, variables, 'GetCustomer');
      
      if (!data.customer) {
        throw new Error(`Customer not found: ${customerId}`);
      }

      logger.debug('Successfully fetched customer', {
        customerId,
        email: data.customer.email,
        fullName: data.customer.fullName
      });

      return data.customer;
    } catch (error) {
      logger.error('Failed to fetch customer', {
        customerId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create a thread event for audit logging
   * @param {string} threadId - Plain thread ID
   * @param {string} title - Event title
   * @param {Object} components - Event content components
   * @returns {Promise<Object>} Created event data
   */
  async createThreadEvent(threadId, title, components) {
    logger.debug('Creating thread event', {
      threadId,
      title
    });

    const mutation = `
      mutation CreateThreadEvent($threadId: ID!, $title: String!, $components: [ComponentInput!]!) {
        createThreadEvent(threadId: $threadId, title: $title, components: $components) {
          id
          title
          createdAt {
            iso8601
          }
        }
      }
    `;

    const variables = {
      threadId,
      title,
      components
    };

    try {
      const data = await this.executeGraphQL(mutation, variables, 'CreateThreadEvent');

      logger.info('Successfully created thread event', {
        threadId,
        eventId: data.createThreadEvent.id,
        title
      });

      return data.createThreadEvent;
    } catch (error) {
      logger.error('Failed to create thread event', {
        threadId,
        title,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Assign a thread to a user (for escalation)
   * @param {string} threadId - Plain thread ID
   * @param {string} userId - User ID to assign to
   * @returns {Promise<Object>} Updated thread data
   */
  async assignThread(threadId, userId) {
    logger.info('Assigning thread to user', {
      threadId,
      userId
    });

    const mutation = `
      mutation AssignThread($threadId: ID!, $userId: ID!) {
        assignThread(threadId: $threadId, userId: $userId) {
          id
          assignedTo {
            id
            fullName
            email
          }
        }
      }
    `;

    const variables = {
      threadId,
      userId
    };

    try {
      const data = await this.executeGraphQL(mutation, variables, 'AssignThread');

      logger.info('Successfully assigned thread', {
        threadId,
        userId,
        assignedToName: data.assignThread.assignedTo?.fullName
      });

      return data.assignThread;
    } catch (error) {
      logger.error('Failed to assign thread', {
        threadId,
        userId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new PlainApiClient();
